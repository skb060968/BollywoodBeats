/**
 * Firebase Sync Module for BollywoodBeats Multiplayer
 * Handles room management and real-time game state synchronization
 */

import { db, auth } from './firebase-config.js';
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const GAME_ID = 'bollywood-beats';

/**
 * Generates a 4-character room code
 */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARSET.length);
    code += ROOM_CODE_CHARSET[idx];
  }
  return code;
}

/**
 * Creates a new multiplayer room
 * @param {string} hostName - Display name of the host
 * @returns {Promise<{ roomCode: string, playerIndex: number }>}
 */
export async function createRoom(hostName) {
  const uid = auth.currentUser?.uid || 'anonymous';
  const roomCode = generateRoomCode();
  const roomRef = ref(db, `${GAME_ID}-rooms/${roomCode}`);

  const roomData = {
    meta: {
      hostUid: uid,
      hostName: hostName,
      status: 'lobby', // lobby, playing, finished
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
    players: {
      player_0: {
        name: hostName,
        uid: uid,
        connected: true,
      },
    },
    game: null,
  };

  await set(roomRef, roomData);
  return { roomCode, playerIndex: 0 };
}

/**
 * Joins an existing room
 * @param {string} roomCode - 4-character room code
 * @param {string} playerName - Display name of the joining player
 * @returns {Promise<{ playerIndex: number }>}
 */
export async function joinRoom(roomCode, playerName) {
  const uid = auth.currentUser?.uid || 'anonymous';
  const roomRef = ref(db, `${GAME_ID}-rooms/${roomCode}`);

  const snapshot = await get(roomRef);
  if (!snapshot.exists()) {
    throw new Error('Room not found');
  }

  const roomData = snapshot.val();
  if (roomData.meta.status !== 'lobby') {
    throw new Error('Game already started');
  }

  // Find next available player slot
  const players = roomData.players || {};
  const playerIndices = Object.keys(players).map(k => parseInt(k.split('_')[1])).sort((a, b) => a - b);
  let nextIndex = 0;
  for (let i = 0; i <= playerIndices.length; i++) {
    if (!playerIndices.includes(i)) {
      nextIndex = i;
      break;
    }
  }

  const playerData = {
    name: playerName,
    uid: uid,
    connected: true,
  };

  await update(ref(db, `${GAME_ID}-rooms/${roomCode}/players/player_${nextIndex}`), playerData);
  await update(ref(db, `${GAME_ID}-rooms/${roomCode}/meta`), { lastActivity: Date.now() });

  return { playerIndex: nextIndex };
}

/**
 * Listens to room changes
 * @param {string} roomCode - Room code to listen to
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onStatusChange - Called when room status changes
 * @param {Function} callbacks.onPlayersChange - Called when players join/leave
 * @param {Function} callbacks.onGameUpdate - Called when game state updates (receives game state and status)
 * @param {Function} callbacks.onRoomDeleted - Called when room is deleted
 * @returns {Function} Unsubscribe function
 */
export function listenRoom(roomCode, callbacks) {
  const roomRef = ref(db, `${GAME_ID}-rooms/${roomCode}`);

  const unsubscribe = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      console.log('[Firebase] Room does not exist:', roomCode);
      if (callbacks.onRoomDeleted) callbacks.onRoomDeleted();
      return;
    }

    const data = snapshot.val();
    const status = data.meta?.status || 'lobby';
    
    console.log('[Firebase] Room update received:', {
      roomCode,
      status,
      hasGame: !!data.game,
      playerCount: Object.keys(data.players || {}).length
    });

    if (callbacks.onStatusChange) {
      callbacks.onStatusChange(status);
    }

    if (callbacks.onPlayersChange) {
      callbacks.onPlayersChange(data.players || {});
    }

    if (callbacks.onGameUpdate && data.game) {
      console.log('[Firebase] Calling onGameUpdate with status:', status);
      callbacks.onGameUpdate(data.game, status);
    } else if (callbacks.onGameUpdate && !data.game) {
      console.log('[Firebase] Game data is null, not calling onGameUpdate');
    }
  });

  return () => off(roomRef);
}

/**
 * Updates game state
 * @param {string} roomCode - Room code
 * @param {Object} gameState - Game state to write
 */
export async function writeGameState(roomCode, gameState) {
  const updates = {
    [`${GAME_ID}-rooms/${roomCode}/game`]: gameState,
    [`${GAME_ID}-rooms/${roomCode}/meta/lastActivity`]: Date.now(),
  };
  await update(ref(db), updates);
}

/**
 * Starts the game (host only)
 * @param {string} roomCode - Room code
 * @param {Object} initialGameState - Initial game state
 */
export async function startGame(roomCode, initialGameState) {
  const updates = {
    [`${GAME_ID}-rooms/${roomCode}/meta/status`]: 'playing',
    [`${GAME_ID}-rooms/${roomCode}/game`]: initialGameState,
    [`${GAME_ID}-rooms/${roomCode}/meta/lastActivity`]: Date.now(),
  };
  await update(ref(db), updates);
}

/**
 * Ends the game
 * @param {string} roomCode - Room code
 */
export async function endGame(roomCode) {
  await update(ref(db, `${GAME_ID}-rooms/${roomCode}/meta`), {
    status: 'finished',
    lastActivity: Date.now(),
  });
}

/**
 * Deletes the room (host only)
 * @param {string} roomCode - Room code
 */
export async function deleteRoom(roomCode) {
  await remove(ref(db, `${GAME_ID}-rooms/${roomCode}`));
}

/**
 * Sets up disconnect handler for a player
 * @param {string} roomCode - Room code
 * @param {number} playerIndex - Player index
 */
export function setupDisconnectHandler(roomCode, playerIndex) {
  const playerRef = ref(db, `${GAME_ID}-rooms/${roomCode}/players/player_${playerIndex}/connected`);
  onDisconnect(playerRef).set(false);
}

/**
 * Removes a player from the room
 * @param {string} roomCode - Room code
 * @param {number} playerIndex - Player index to remove
 */
export async function removePlayer(roomCode, playerIndex) {
  await remove(ref(db, `${GAME_ID}-rooms/${roomCode}/players/player_${playerIndex}`));
}
