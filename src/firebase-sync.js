/**
 * Transaction-safe Firebase synchronization for Bollywood Beats.
 * Public room state never contains the host's phrase deck or answers.
 */

import { db, authReady } from './firebase-config.js';
import {
  get,
  off,
  onChildAdded,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';

export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;
export const MAX_PLAYERS = 8;
const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOMS_PATH = 'bollywood-beats-rooms';
const CREATE_ATTEMPTS = 12;
const disconnectRegistrations = new Map();

function roomPath(roomCode, suffix = '') {
  if (!ROOM_CODE_PATTERN.test(roomCode)) throw new Error('Invalid room code');
  return `${ROOMS_PATH}/${roomCode}${suffix ? `/${suffix}` : ''}`;
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 15) throw new Error('Name must be 1–15 characters');
  return value;
}

async function currentUser() {
  const user = await authReady;
  if (!user?.uid) throw new Error('Firebase authentication failed');
  return user;
}

export function generateRoomCode() {
  const randomValues = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomValues);
  } else {
    for (let index = 0; index < randomValues.length; index += 1) {
      randomValues[index] = Math.floor(Math.random() * 0x100000000);
    }
  }
  return Array.from(randomValues, value => ROOM_CODE_CHARSET[value % ROOM_CODE_CHARSET.length]).join('');
}

export async function createRoom(hostName) {
  const user = await currentUser();
  const name = normalizeName(hostName);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode();
    const roomRef = ref(db, roomPath(roomCode));
    const initialRoom = {
      meta: {
        schemaVersion: 2,
        hostUid: user.uid,
        hostName: name,
        status: 'lobby',
        createdAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      },
      players: {
        player_0: {
          name,
          uid: user.uid,
          connected: true,
          joinedAt: serverTimestamp(),
        },
      },
    };
    try {
      await set(roomRef, initialRoom);
      return { roomCode, playerIndex: 0, uid: user.uid };
    } catch (error) {
      if (attempt === CREATE_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error('Could not reserve a room code. Please try again.');
}

function isPermissionDenied(error) {
  const blob = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return blob.includes('permission');
}

export async function joinRoom(rawRoomCode, playerName) {
  const user = await currentUser();
  const roomCode = String(rawRoomCode || '').trim().toUpperCase();
  const name = normalizeName(playerName);
  const metaSnapshot = await get(ref(db, roomPath(roomCode, 'meta')));
  if (!metaSnapshot.exists()) throw new Error('Room not found');
  if (metaSnapshot.val().schemaVersion !== 2) throw new Error('This room uses an unsupported version');
  if (metaSnapshot.val().status !== 'lobby') throw new Error('Game already started');

  const playersRef = ref(db, roomPath(roomCode, 'players'));
  let players = (await get(playersRef)).val() || {};

  // If this browser's uid already holds a slot, restore its connection rather
  // than taking a new one.
  const ownedKey = Object.keys(players).find((key) => players[key]?.uid === user.uid);
  if (ownedKey) {
    const idx = Number(ownedKey.slice('player_'.length));
    await restoreConnection(roomCode, idx);
    return { playerIndex: idx, uid: user.uid };
  }

  // Claim the lowest free slot with a PER-CHILD create transaction. Writing only
  // our own `players/player_N` node (never the whole players map) means we can
  // never displace another player, and the rules authorize each slot on its own.
  for (let index = 1; index < MAX_PLAYERS; index += 1) {
    const key = `player_${index}`;
    if (players[key]) continue;
    try {
      const result = await runTransaction(
        ref(db, roomPath(roomCode, `players/${key}`)),
        current => (current === null
          ? { name, uid: user.uid, connected: true, joinedAt: serverTimestamp() }
          : undefined),
        { applyLocally: false },
      );
      if (result.committed) return { playerIndex: index, uid: user.uid };
      // Slot was taken between our read and the write — refresh and try the next.
      players = (await get(playersRef)).val() || {};
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // Rules rejected (slot raced, or the lobby just closed). Re-read to decide.
      players = (await get(playersRef)).val() || {};
      const mine = Object.keys(players).find((k) => players[k]?.uid === user.uid);
      if (mine) return { playerIndex: Number(mine.slice('player_'.length)), uid: user.uid };
      const status = (await get(ref(db, roomPath(roomCode, 'meta/status')))).val();
      if (status !== 'lobby') throw new Error('Game already started');
    }
  }
  throw new Error('Room is full');
}

export function listenRoom(roomCode, callbacks = {}) {
  const base = roomPath(roomCode);
  let latestStatus = 'lobby';
  let latestGame = null;
  const emitGame = () => callbacks.onGameUpdate?.(latestGame, latestStatus);
  const unsubscribers = [
    onValue(ref(db, `${base}/meta`), snapshot => {
      if (!snapshot.exists()) {
        callbacks.onRoomDeleted?.();
        return;
      }
      latestStatus = snapshot.val().status || 'lobby';
      callbacks.onStatusChange?.(latestStatus, snapshot.val());
      if (latestGame) emitGame();
    }, error => callbacks.onError?.(error)),
    onValue(ref(db, `${base}/players`), snapshot => {
      callbacks.onPlayersChange?.(snapshot.val() || {});
    }, error => callbacks.onError?.(error)),
    onValue(ref(db, `${base}/game`), snapshot => {
      latestGame = snapshot.val();
      emitGame();
    }, error => callbacks.onError?.(error)),
  ];
  if (callbacks.onFinalRevealAcksChange) {
    unsubscribers.push(onValue(ref(db, `${base}/finalRevealAcks`), snapshot => {
      callbacks.onFinalRevealAcksChange(snapshot.val() || {});
    }, error => callbacks.onError?.(error)));
  }
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export async function acknowledgeFinalReveal(roomCode, revealId) {
  if (!Number.isSafeInteger(revealId) || revealId <= 0) {
    throw new Error('Invalid final reveal token');
  }
  const user = await currentUser();
  await set(ref(db, roomPath(roomCode, `finalRevealAcks/${user.uid}`)), revealId);
}

export async function startGame(roomCode, publicGameState, phraseDeck) {
  const user = await currentUser();
  await update(ref(db, roomPath(roomCode)), {
    game: publicGameState,
    [`private/${user.uid}`]: { phraseDeck: JSON.stringify(phraseDeck) },
    'meta/status': 'playing',
    'meta/lastActivity': serverTimestamp(),
  });
}

export async function writeGameState(roomCode, publicGameState) {
  await update(ref(db, roomPath(roomCode)), {
    game: publicGameState,
    'meta/lastActivity': serverTimestamp(),
  });
}

export async function transactGameState(roomCode, reducer) {
  const gameRef = ref(db, roomPath(roomCode, 'game'));
  return runTransaction(gameRef, current => current ? reducer(current) : undefined, {
    applyLocally: false,
  });
}

export async function endGame(roomCode, publicGameState) {
  await update(ref(db, roomPath(roomCode)), {
    game: publicGameState,
    'meta/status': 'finished',
    'meta/lastActivity': serverTimestamp(),
  });
}

export async function getHostPhraseDeck(roomCode) {
  const user = await currentUser();
  const snapshot = await get(ref(db, roomPath(roomCode, `private/${user.uid}/phraseDeck`)));
  if (!snapshot.exists()) throw new Error('Host phrase data is unavailable');
  const deck = JSON.parse(snapshot.val());
  if (!Array.isArray(deck) || deck.length < 1) throw new Error('Host phrase data is invalid');
  return deck;
}

export async function submitGameAction(roomCode, action) {
  const user = await currentUser();
  const actionRef = ref(db, roomPath(roomCode, `actions/${user.uid}`));
  const payload = {
    actorUid: user.uid,
    type: action.type,
    createdAt: serverTimestamp(),
  };
  if (action.type === 'guess') payload.letter = action.letter;
  if (action.type === 'lifeline') payload.lifelineIndex = action.lifelineIndex;
  await set(actionRef, payload);
  return user.uid;
}

export function listenGameActions(roomCode, callback, onError) {
  return onChildAdded(ref(db, roomPath(roomCode, 'actions')), snapshot => {
    callback(snapshot.key, snapshot.val());
  }, onError);
}

export async function removeGameAction(roomCode, actionId) {
  await remove(ref(db, roomPath(roomCode, `actions/${actionId}`)));
}

export async function setupDisconnectHandler(roomCode, playerIndex) {
  const key = `${roomCode}:${playerIndex}`;
  await disconnectRegistrations.get(key)?.cancel().catch(() => {});
  const connectedRef = ref(db, roomPath(roomCode, `players/player_${playerIndex}/connected`));
  const infoRef = ref(db, '.info/connected');
  let registration = null;
  let disposed = false;
  // Re-arm the offline write and self-heal `connected=true` on every (re)connect,
  // so a brief drop that fired onDisconnect is undone automatically.
  const handler = async (snapshot) => {
    if (!snapshot.val() || disposed) return;
    try {
      registration = onDisconnect(connectedRef);
      await registration.set(false);
      if (!disposed) await set(connectedRef, true);
    } catch (_) { /* transient presence write failure */ }
  };
  onValue(infoRef, handler);
  const entry = {
    async cancel() {
      disposed = true;
      off(infoRef, 'value', handler);
      if (registration) { try { await registration.cancel(); } catch (_) {} }
    },
  };
  disconnectRegistrations.set(key, entry);
  return async () => {
    await entry.cancel();
    disconnectRegistrations.delete(key);
  };
}

export async function cancelDisconnectHandler(roomCode, playerIndex) {
  const key = `${roomCode}:${playerIndex}`;
  const registration = disconnectRegistrations.get(key);
  if (registration) await registration.cancel().catch(() => {});
  disconnectRegistrations.delete(key);
}

export async function restoreConnection(rawRoomCode, playerIndex) {
  const user = await currentUser();
  const roomCode = String(rawRoomCode || '').trim().toUpperCase();
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= MAX_PLAYERS) {
    throw new Error('Invalid saved player slot');
  }
  const [metaSnapshot, playerSnapshot, gameSnapshot] = await Promise.all([
    get(ref(db, roomPath(roomCode, 'meta'))),
    get(ref(db, roomPath(roomCode, `players/player_${playerIndex}`))),
    get(ref(db, roomPath(roomCode, 'game'))),
  ]);
  if (!metaSnapshot.exists() || !playerSnapshot.exists()) throw new Error('Saved room no longer exists');
  const meta = metaSnapshot.val();
  const player = playerSnapshot.val();
  if (meta.schemaVersion !== 2 || player.uid !== user.uid) throw new Error('Saved session does not match this device');
  if (meta.status === 'finished') throw new Error('Game has ended');
  await update(ref(db, roomPath(roomCode, `players/player_${playerIndex}`)), { connected: true });
  await setupDisconnectHandler(roomCode, playerIndex);
  return { meta, player, game: gameSnapshot.val(), uid: user.uid };
}

export async function removePlayer(roomCode, playerIndex) {
  await currentUser();
  await cancelDisconnectHandler(roomCode, playerIndex);
  await remove(ref(db, roomPath(roomCode, `players/player_${playerIndex}`)));
}

export async function deleteRoom(roomCode) {
  await currentUser();
  for (const key of [...disconnectRegistrations.keys()]) {
    if (key.startsWith(`${roomCode}:`)) {
      const registration = disconnectRegistrations.get(key);
      await registration?.cancel().catch(() => {});
      disconnectRegistrations.delete(key);
    }
  }
  await remove(ref(db, roomPath(roomCode)));
}