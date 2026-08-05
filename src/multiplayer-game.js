/**
 * Bollywood Beats - Multiplayer Version
 * Real-time collaborative phrase guessing game
 */

import {
  ROOM_CODE_PATTERN,
  cancelDisconnectHandler,
  createRoom as firebaseCreateRoom,
  deleteRoom,
  endGame as firebaseEndGame,
  getHostPhraseDeck,
  joinRoom as firebaseJoinRoom,
  listenGameActions,
  listenRoom,
  removeGameAction,
  removePlayer as firebaseRemovePlayer,
  restoreConnection,
  setupDisconnectHandler,
  startGame as firebaseStartGame,
  submitGameAction,
  transactGameState,
} from './firebase-sync.js';
import { initDeepLinkHandler, createShareHandler, showQRCode } from './deep-link-handler.js';

// ========== SPEECH PHRASES ==========
const SpeechPhrases = {
    encourage: [
        "Great job!",
        "Excellent choice!",
        "Perfect guess!",
        "Brilliant move!",
        "Superb thinking!",
        "Outstanding work!",
        "Fantastic play!",
        "Amazing guess!",
        "Well done!",
        "Awesome work!"
    ],
    disappoint: [
        "Oops! Try again",
        "Not quite right",
        "Think again carefully",
        "Oh no! Wrong one",
        "Missed it! Continue",
        "Better luck next",
        "Almost there! Keep going",
        "Keep trying hard",
        "Don't give up",
        "Next time buddy"
    ],
    levelComplete: [
        "Level complete!"
    ]
};

// ========== AUDIO MANAGER WITH MP3 FILES AND SPEECH ==========
const AudioManager = (() => {
    const SOUND_FILES = {
        correct: './sounds/correct.mp3',
        wrong: './sounds/wrong.mp3',
        win: './sounds/win.mp3',
        music: './sounds/music.mp3',
    };

    const MUTE_KEY = 'bollywood_beats_multiplayer_muted';
    let backgroundMusic = null;
    let currentSoundEffect = null;
    let speechSynthesis = window.speechSynthesis;
    let isSpeaking = false; // Track if speech is in progress
    let speechQueue = []; // Queue for pending speech
    let voicesLoaded = false;
    let speechSupported = true; // Track if speech synthesis actually works
    
    // Wait for voices to load
    if (speechSynthesis) {
        speechSynthesis.onvoiceschanged = () => {
            voicesLoaded = true;
            console.log('[Speech] Voices loaded:', speechSynthesis.getVoices().length);
        };
        
        // Check if voices are already loaded
        setTimeout(() => {
            if (speechSynthesis.getVoices().length > 0) {
                voicesLoaded = true;
                console.log('[Speech] Voices already available:', speechSynthesis.getVoices().length);
            } else {
                console.log('[Speech] No voices available - speech may not be supported');
                speechSupported = false;
            }
        }, 100);
    } else {
        speechSupported = false;
        console.log('[Speech] speechSynthesis API not available');
    }

    function isMuted() {
        try {
            const v = localStorage.getItem(MUTE_KEY);
            return v === '1' || v === 'true';
        } catch (_) {
            return false;
        }
    }

    function setMuted(muted) {
        try {
            localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        } catch (_) {}
        
        if (muted) {
            pauseBackgroundMusic();
            stopSoundEffects();
            if (speechSynthesis) {
                speechSynthesis.cancel();
                isSpeaking = false; // Reset speaking flag
                speechQueue = []; // Clear speech queue
            }
        } else {
            resumeBackgroundMusic();
        }
    }

    function toggleMute() {
        const next = !isMuted();
        setMuted(next);
        return next;
    }

    function stopSoundEffects() {
        if (currentSoundEffect) {
            try {
                currentSoundEffect.pause();
                currentSoundEffect.currentTime = 0;
                currentSoundEffect = null;
            } catch (_) {}
        }
    }

    function playSound(name, volume = 1.0) {
        if (isMuted()) return;
        
        const url = SOUND_FILES[name];
        if (!url) return;
        
        try {
            stopSoundEffects();
            
            const audio = new Audio(url);
            audio.volume = volume;
            currentSoundEffect = audio;
            
            audio.onended = () => {
                if (currentSoundEffect === audio) {
                    currentSoundEffect = null;
                }
            };
            
            audio.play().catch(() => {});
        } catch (_) {}
    }

    function speak(text, rate = 1.0, pitch = 1.1) {
        console.log('[Speech] speak() called with text:', text);
        
        if (isMuted()) {
            console.log('[Speech] Muted, skipping');
            return;
        }
        
        // If speech not supported, just show visual animation
        if (!speechSynthesis || !speechSupported) {
            console.log('[Speech] Speech not supported, showing visual-only animation');
            showTalkingCharacter();
            // Show talking animation for 2 seconds then switch to idle
            setTimeout(() => {
                if (!isSpeaking) {
                    showIdleCharacter();
                }
            }, 2000);
            return;
        }
        
        // If already speaking, queue this speech to play after current one finishes
        if (isSpeaking) {
            console.log('[Speech] Already speaking, queueing speech:', text);
            speechQueue.push({ text, rate, pitch });
            return;
        }
        
        try {
            // Cancel any stuck speech before starting new one
            speechSynthesis.cancel();
            
            isSpeaking = true;
            let speechStarted = false;
            let speechEnded = false;
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = 1.0;
            utterance.lang = 'en-US';
            
            // Select voice if available
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                const englishVoice = voices.find(v => v.lang.startsWith('en-')) || voices[0];
                utterance.voice = englishVoice;
                console.log('[Speech] Using voice:', englishVoice.name);
            } else {
                // No voices available - speech won't work
                console.log('[Speech] No voices available, falling back to visual-only');
                speechSupported = false;
                isSpeaking = false;
                showTalkingCharacter();
                setTimeout(() => showIdleCharacter(), 2000);
                return;
            }
            
            // Track when speech actually starts
            utterance.onstart = () => {
                speechStarted = true;
                console.log('[Speech] Speech started:', text);
            };
            
            // When speech ends, check queue and play next or switch to idle
            utterance.onend = () => {
                // Prevent double-firing of end event
                if (speechEnded) return;
                speechEnded = true;
                
                // Only process end if speech actually started
                if (!speechStarted) {
                    console.log('[Speech] Speech ended without starting, ignoring');
                    isSpeaking = false;
                    showIdleCharacter();
                    return;
                }
                
                console.log('[Speech] Speech ended');
                isSpeaking = false;
                
                // Check if there's queued speech
                if (speechQueue.length > 0) {
                    const nextSpeech = speechQueue.shift();
                    console.log('[Speech] Playing queued speech:', nextSpeech.text);
                    // Small delay before next speech
                    setTimeout(() => speak(nextSpeech.text, nextSpeech.rate, nextSpeech.pitch), 100);
                } else {
                    console.log('[Speech] No queued speech, switching to idle');
                    showIdleCharacter();
                }
            };
            
            utterance.onerror = (err) => {
                console.error('[Speech] Speech error:', err.error, err);
                speechEnded = true;
                isSpeaking = false;
                speechQueue = []; // Clear queue on error
                showIdleCharacter();
            };
            
            // Switch to talking character immediately
            showTalkingCharacter();
            
            // Small delay before speaking to ensure browser is ready
            setTimeout(() => {
                console.log('[Speech] Starting speech synthesis');
                speechSynthesis.speak(utterance);
            }, 50);
            
            // Failsafe: if speech doesn't start within 1000ms, reset
            setTimeout(() => {
                if (!speechStarted && isSpeaking) {
                    console.log('[Speech] Speech failed to start within 1s, resetting');
                    isSpeaking = false;
                    speechSynthesis.cancel();
                    showIdleCharacter();
                    
                    // Try to play queued speech
                    if (speechQueue.length > 0) {
                        const nextSpeech = speechQueue.shift();
                        speak(nextSpeech.text, nextSpeech.rate, nextSpeech.pitch);
                    }
                }
            }, 1000);
            
        } catch (err) {
            console.error('[Speech] Speech synthesis error:', err);
            isSpeaking = false;
            speechQueue = []; // Clear queue on error
            showIdleCharacter();
        }
    }
    
    function showTalkingCharacter() {
        const idleVideo = document.getElementById('characterIdle');
        const talkingVideo = document.getElementById('characterTalking');
        
        if (!idleVideo || !talkingVideo) return;
        
        console.log('[Character] Switching to talking video');
        
        // Hide and pause idle video without waiting
        if (idleVideo.style.display !== 'none') {
            idleVideo.style.display = 'none';
            idleVideo.pause();
        }
        
        // Show and play talking video WITH loop (keeps playing until speech ends)
        if (talkingVideo.style.display !== 'block') {
            talkingVideo.style.display = 'block';
            talkingVideo.loop = true; // Loop continuously while speech is playing
            talkingVideo.currentTime = 0;
            
            talkingVideo.play().catch(err => {
                console.error('[Character] Failed to play talking video:', err);
            });
        }
    }
    
    function showIdleCharacter() {
        const idleVideo = document.getElementById('characterIdle');
        const talkingVideo = document.getElementById('characterTalking');
        
        if (!idleVideo || !talkingVideo) return;
        
        console.log('[Character] Switching to idle video');
        
        // Hide and pause talking video immediately (no delay)
        if (talkingVideo.style.display !== 'none') {
            talkingVideo.style.display = 'none';
            talkingVideo.pause();
        }
        
        // Show and play idle video immediately
        if (idleVideo.style.display !== 'block') {
            idleVideo.style.display = 'block';
            idleVideo.currentTime = 0;
            idleVideo.play().catch(err => {
                console.error('[Character] Failed to play idle video:', err);
            });
        }
    }

    function playRandomEncourage() {
        console.log('[AudioManager] playRandomEncourage() called');
        const phrases = SpeechPhrases.encourage;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        console.log('[AudioManager] Selected encourage phrase:', phrase);
        speak(phrase, 1.1, 1.2);
    }

    function playRandomDisappoint() {
        console.log('[AudioManager] playRandomDisappoint() called');
        const phrases = SpeechPhrases.disappoint;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        console.log('[AudioManager] Selected disappoint phrase:', phrase);
        speak(phrase, 0.95, 0.9);
    }

    function playRandomLevelComplete() {
        console.log('[AudioManager] playRandomLevelComplete() called');
        const phrases = SpeechPhrases.levelComplete;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        console.log('[AudioManager] Selected levelComplete phrase:', phrase);
        speak(phrase, 1.15, 1.3); // No priority parameter - simpler approach
    }

    function startBackgroundMusic(volume = 0.15) {
        if (isMuted()) return;
        
        stopBackgroundMusic();
        
        const url = SOUND_FILES.music;
        if (!url) return;
        
        try {
            backgroundMusic = new Audio(url);
            backgroundMusic.loop = true;
            backgroundMusic.volume = volume;
            backgroundMusic.preload = 'auto';
            
            // Hide audio element metadata display
            backgroundMusic.style.display = 'none';
            backgroundMusic.style.position = 'absolute';
            backgroundMusic.style.visibility = 'hidden';
            backgroundMusic.style.width = '0';
            backgroundMusic.style.height = '0';
            backgroundMusic.style.opacity = '0';
            
            const playPromise = backgroundMusic.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {
                    console.log('Background music autoplay blocked');
                });
            }
        } catch (err) {
            console.error('Failed to start background music:', err);
        }
    }

    function stopBackgroundMusic() {
        if (backgroundMusic) {
            try {
                backgroundMusic.pause();
                backgroundMusic.currentTime = 0;
                backgroundMusic = null;
            } catch (_) {}
        }
        
        if (speechSynthesis) {
            speechSynthesis.cancel();
        }
    }

    function pauseBackgroundMusic() {
        if (backgroundMusic) {
            try {
                backgroundMusic.pause();
            } catch (_) {}
        }
    }

    function resumeBackgroundMusic() {
        if (backgroundMusic && backgroundMusic.paused && !isMuted()) {
            try {
                const playPromise = backgroundMusic.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                }
            } catch (_) {}
        }
    }

    function stopSoundEffects() {
        if (currentSoundEffect) {
            try {
                currentSoundEffect.pause();
                currentSoundEffect.currentTime = 0;
                currentSoundEffect = null;
            } catch (_) {}
        }
    }

    return {
        playSound,
        playRandomEncourage,
        playRandomDisappoint,
        playRandomLevelComplete,
        toggleMute,
        isMuted,
        startBackgroundMusic,
        stopBackgroundMusic,
        stopSoundEffects,
    };
})();

// ========== GAME STATE ==========
let roomCode = null;
let playerIndex = null;
let playerUid = null;
let isHost = false;
let unsubscribeRoom = null;
let unsubscribeActions = null;
let cancelDisconnect = null;
let timerInterval = null;
let levelAdvanceTimer = null;
let hostPhraseDeck = [];
let actionQueue = Promise.resolve();
const pendingLetters = new Set();

const SESSION_KEY = 'bollywood_beats_session_v2';

let gameState = {
    currentPhraseIndex: 0,
    phraseDisplay: '',
    currentCategory: '',
    guessedLetters: new Set(),
    correctLetters: new Set(),
    wrongGuesses: 0,
    maxWrongGuesses: 6,
    currentLevel: 1,
    maxLevels: 10,
    score: 0,
    timeRemaining: 1200,
    timerDuration: 1200,
    deadline: 0,
    lifelinesRemaining: 3,
    lifelinesUsed: [false, false, false],
    gameResult: 'none',
    phase: 'active',
    advanceAt: 0,
    lastAction: 'none',
    lastActionId: 0,
    lastActorUid: '',
    revision: 0,
};

// ========== SESSION PERSISTENCE ==========
function saveSession() {
    if (roomCode != null && playerIndex != null && playerUid) {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerIndex, playerUid, isHost }));
            localStorage.removeItem('bollywood_beats_session');
        } catch (_) {}
    }
}

function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('bollywood_beats_session');
    } catch (_) {}
}

function loadSession() {
    try {
        const data = localStorage.getItem(SESSION_KEY);
        const session = data ? JSON.parse(data) : null;
        if (!session || !ROOM_CODE_PATTERN.test(session.roomCode) || !Number.isInteger(session.playerIndex)) return null;
        return session;
    } catch (_) {
        return null;
    }
}

// ========== UTILITY FUNCTIONS ==========
function showScreen(screenId) {
    console.log('[ShowScreen] Switching to screen:', screenId);
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        console.log('[ShowScreen] Screen activated:', screenId);
    } else {
        console.error('[ShowScreen] Screen not found:', screenId);
    }
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toastNotification');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = 'toast-notification' + (isError ? ' error' : '');
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function showLoading(message = 'Loading...') {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        const textEl = loader.querySelector('.loading-text');
        if (textEl) textEl.textContent = message;
        loader.style.display = 'flex';
    }
}

function hideLoading() {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.style.display = 'none';
    }
}

// ========== SCREEN NAVIGATION ==========
window.showMenu = function() {
    stopTimer();
    if (levelAdvanceTimer) {
        clearTimeout(levelAdvanceTimer);
        levelAdvanceTimer = null;
    }
    AudioManager.stopBackgroundMusic();
    clearSession();
    unsubscribeRoom?.();
    unsubscribeActions?.();
    unsubscribeRoom = null;
    unsubscribeActions = null;
    if (cancelDisconnect) Promise.resolve(cancelDisconnect()).catch(() => {});
    cancelDisconnect = null;
    roomCode = null;
    playerIndex = null;
    playerUid = null;
    isHost = false;
    hostPhraseDeck = [];
    pendingLetters.clear();
    previousActionId = 0;
    previousResult = 'none';
    showScreen('menuScreen');
};

window.showCreateRoom = function() {
    showScreen('createRoomScreen');
    document.getElementById('hostNameInput').value = '';
    document.getElementById('hostNameInput').focus();
};

window.showJoinRoom = function() {
    showScreen('joinRoomScreen');
    document.getElementById('playerNameInput').value = '';
    document.getElementById('roomCodeInput').value = '';
    document.getElementById('playerNameInput').focus();
};

window.showInstructions = function() {
    showScreen('instructionsScreen');
};

// ========== ROOM MANAGEMENT ==========
window.createRoom = async function() {
    const nameInput = document.getElementById('hostNameInput');
    const name = nameInput.value.trim();
    
    if (!name) {
        showToast('Please enter your name', true);
        nameInput.focus();
        return;
    }
    
    try {
        showLoading('Creating room...');
        const result = await firebaseCreateRoom(name);
        roomCode = result.roomCode;
        playerIndex = result.playerIndex;
        playerUid = result.uid;
        isHost = true;
        cancelDisconnect = await setupDisconnectHandler(roomCode, playerIndex);
        saveSession();
        startLobbyListener();
        showLobby();
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Failed to create room:', error);
        showToast('Failed to create room. Please try again.', true);
    }
};

window.joinRoom = async function() {
    const nameInput = document.getElementById('playerNameInput');
    const codeInput = document.getElementById('roomCodeInput');
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    
    if (!name) {
        showToast('Please enter your name', true);
        nameInput.focus();
        return;
    }
    
    if (!ROOM_CODE_PATTERN.test(code)) {
        showToast('Please enter a valid 4-character room code', true);
        codeInput.focus();
        return;
    }
    
    try {
        showLoading('Joining room...');
        const result = await firebaseJoinRoom(code, name);
        roomCode = code;
        playerIndex = result.playerIndex;
        playerUid = result.uid;
        isHost = false;
        cancelDisconnect = await setupDisconnectHandler(roomCode, playerIndex);
        saveSession();
        startLobbyListener();
        showLobby();
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Failed to join room:', error);
        showToast(error.message || 'Failed to join room', true);
    }
};

function showLobby() {
    showScreen('lobbyScreen');
    document.getElementById('lobbyRoomCode').textContent = roomCode;
    
    // Show start button only for host
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
        startBtn.style.display = isHost ? 'block' : 'none';
    }
    
    // Wire up share and QR code buttons
    const shareBtn = document.getElementById('shareRoomBtn');
    const qrBtn = document.getElementById('qrCodeBtn');
    
    if (shareBtn) {
        shareBtn.onclick = createShareHandler(roomCode, 'Bollywood Beats');
    }
    
    if (qrBtn) {
        qrBtn.onclick = () => showQRCode(roomCode, 'Bollywood Beats');
    }
}

function startLobbyListener() {
    unsubscribeRoom?.();
    unsubscribeActions?.();
    unsubscribeActions = null;

    let finishSyncPromise = null;
    const reconcileFinishedRoom = (game) => {
        if (!isHost || game?.gameResult === 'none' || finishSyncPromise) return;
        finishSyncPromise = (async () => {
            let lastError;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    await firebaseEndGame(roomCode, game);
                    return;
                } catch (error) {
                    lastError = error;
                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
                    }
                }
            }
            throw lastError;
        })().catch(error => {
            console.error('Failed to reconcile finished room status:', error);
            showToast('Final game status will retry after reconnect', true);
        }).finally(() => {
            finishSyncPromise = null;
        });
    };

    unsubscribeRoom = listenRoom(roomCode, {
        onStatusChange: (status) => {
            if (status === 'finished') stopTimer();
        },
        onPlayersChange: (players) => {
            updatePlayersList(players);
            const host = players.player_0;
            if (!isHost && host && !host.connected) {
                showToast('Host disconnected — game will resume when the host returns', true);
            }
        },
        onGameUpdate: (game, status) => {
            if (!game) return;
            updateGameFromFirebase(game);
            if (status === 'playing' && game.gameResult !== 'none') {
                reconcileFinishedRoom(game);
            }
            if (status === 'playing' && game.gameResult === 'none') {
                const currentScreen = document.querySelector('.screen.active');
                if (currentScreen?.id !== 'gameScreen') {
                    showScreen('gameScreen');
                    hideLoading();
                    startTimer();
                    AudioManager.startBackgroundMusic(0.15);
                }
            }
        },
        onRoomDeleted: () => {
            showToast('Room closed by host', true);
            window.showMenu();
        },
        onError: (error) => {
            console.error('Room listener failed:', error);
            showToast('Room connection was lost', true);
        },
    });

    if (isHost) {
        unsubscribeActions = listenGameActions(roomCode, enqueueHostAction, error => {
            console.error('Action listener failed:', error);
        });
    }
}

function updatePlayersList(players) {
    const list = document.getElementById('playersList');
    if (!list) return;
    if (playerIndex != null && !players[`player_${playerIndex}`]) {
        showToast('You were removed from the room', true);
        window.showMenu();
        return;
    }
    list.innerHTML = '';
    
    const playerEntries = Object.entries(players).sort((a, b) => {
        const indexA = parseInt(a[0].split('_')[1]);
        const indexB = parseInt(b[0].split('_')[1]);
        return indexA - indexB;
    });
    
    playerEntries.forEach(([key, player]) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = player.name;
        
        const statusSpan = document.createElement('span');
        statusSpan.className = `player-status ${player.connected ? 'connected' : 'disconnected'}`;
        statusSpan.textContent = player.connected ? '🟢' : '🔴';
        
        playerDiv.appendChild(nameSpan);
        
        // Show host badge
        if (key === 'player_0') {
            const badge = document.createElement('span');
            badge.className = 'player-badge';
            badge.textContent = 'HOST';
            playerDiv.appendChild(badge);
        }
        
        // Show remove button for host (but not for themselves)
        if (isHost && key !== 'player_0') {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-player-btn';
            removeBtn.textContent = '✕';
            removeBtn.title = 'Remove player';
            removeBtn.onclick = () => removePlayer(key, player.name);
            playerDiv.appendChild(removeBtn);
        }
        
        playerDiv.appendChild(statusSpan);
        list.appendChild(playerDiv);
    });
}

window.leaveLobby = async function() {
    try {
        if (isHost) {
            // Host deletes the entire room
            await deleteRoom(roomCode);
        } else {
            // Regular player removes themselves from the room
            await firebaseRemovePlayer(roomCode, playerIndex);
        }
        showMenu();
    } catch (error) {
        console.error('Error leaving lobby:', error);
        showMenu();
    }
};

// Remove a player from the room (host only or self)
window.removePlayer = async function(playerKey, playerName) {
    if (!isHost) return;
    
    try {
        const playerIdx = parseInt(playerKey.split('_')[1]);
        await firebaseRemovePlayer(roomCode, playerIdx);
        showToast(`${playerName} removed from room`);
    } catch (error) {
        console.error('Error removing player:', error);
        showToast('Failed to remove player', true);
    }
};

// ========== GAME START ==========
window.startMultiplayerGame = async function() {
    if (!isHost) return;

    try {
        showLoading('Loading phrases...');
        hostPhraseDeck = await loadAndShufflePhrases();
        previousActionId = 0;
        previousResult = 'none';
        pendingLetters.clear();
        const phraseData = hostPhraseDeck[0];
        const now = Date.now();
        gameState = {
            currentPhraseIndex: 0,
            phraseDisplay: maskPhrase(phraseData.text),
            currentCategory: phraseData.category,
            guessedLetters: new Set(),
            correctLetters: new Set(),
            wrongGuesses: 0,
            maxWrongGuesses: 6,
            currentLevel: 1,
            maxLevels: 10,
            score: 0,
            timeRemaining: gameState.timerDuration,
            timerDuration: gameState.timerDuration,
            deadline: now + gameState.timerDuration * 1000,
            lifelinesRemaining: 3,
            lifelinesUsed: [false, false, false],
            gameResult: 'none',
            phase: 'active',
            advanceAt: 0,
            lastAction: 'none',
            lastActionId: now,
            lastActorUid: playerUid,
            revision: 1,
        };
        await firebaseStartGame(roomCode, serializeGameState(gameState), hostPhraseDeck);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Failed to start game:', error);
        showToast('Failed to start game. Please try again.', true);
    }
};

// ========== GAME STATE SYNC ==========
function maskPhrase(phrase) {
    return phrase.toUpperCase().replace(/[A-Z0-9]/g, '_');
}

function revealLetter(answer, display, letter) {
    return Array.from(display, (character, index) => answer[index] === letter ? letter : character).join('');
}

function serializeGameState(state) {
    return {
        currentPhraseIndex: state.currentPhraseIndex,
        phraseDisplay: state.phraseDisplay,
        currentCategory: state.currentCategory,
        guessedLetters: [...state.guessedLetters].sort().join(''),
        correctLetters: [...state.correctLetters].sort().join(''),
        wrongGuesses: state.wrongGuesses,
        maxWrongGuesses: state.maxWrongGuesses,
        currentLevel: state.currentLevel,
        maxLevels: state.maxLevels,
        score: state.score,
        timerDuration: state.timerDuration,
        deadline: state.deadline,
        lifelinesRemaining: state.lifelinesRemaining,
        lifelinesUsed: state.lifelinesUsed.map(Boolean).map(Number).join(''),
        gameResult: state.gameResult,
        phase: state.phase,
        advanceAt: state.advanceAt,
        lastAction: state.lastAction,
        lastActionId: state.lastActionId,
        lastActorUid: state.lastActorUid,
        revision: state.revision,
    };
}

function deserializeGameState(firebaseState) {
    const deadline = Number(firebaseState.deadline) || 0;
    return {
        ...firebaseState,
        guessedLetters: new Set(firebaseState.guessedLetters || ''),
        correctLetters: new Set(firebaseState.correctLetters || ''),
        lifelinesUsed: String(firebaseState.lifelinesUsed || '000').split('').map(value => value === '1'),
        timeRemaining: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
        deadline,
    };
}

let previousActionId = 0;
let previousResult = 'none';

function updateGameFromFirebase(firebaseGameState) {
    if (!firebaseGameState) return;
    const hadPreviousAction = previousActionId !== 0;
    gameState = deserializeGameState(firebaseGameState);
    for (const letter of gameState.guessedLetters) pendingLetters.delete(letter);

    if (gameState.lastActionId !== previousActionId) {
        previousActionId = gameState.lastActionId;
        if (hadPreviousAction) {
            switch (gameState.lastAction) {
                case 'correct':
                case 'lifeline':
                    AudioManager.playSound('correct');
                    AudioManager.playRandomEncourage();
                    break;
                case 'wrong':
                    AudioManager.playSound('wrong');
                    AudioManager.playRandomDisappoint();
                    break;
                case 'levelComplete':
                    AudioManager.playSound('win', 0.25);
                    AudioManager.playRandomLevelComplete();
                    break;
            }
        }
    }

    updateGameUI();
    displayPhrase();
    createKeyboard();
    if (isHost && gameState.phase === 'levelComplete') scheduleLevelAdvance();

    if (gameState.gameResult !== 'none' && gameState.gameResult !== previousResult) {
        previousResult = gameState.gameResult;
        showGameOver(gameState.gameResult === 'won');
    }
}

// ========== GAME UI ==========
function updateGameUI() {
    // Update score
    const scoreEl = document.getElementById('scoreDisplay');
    if (scoreEl) scoreEl.textContent = gameState.score;
    
    // Update level dots
    const levelsDots = document.getElementById('levelsDots');
    if (levelsDots) {
        levelsDots.innerHTML = '';
        for (let i = 0; i < gameState.maxLevels; i++) {
            const dot = document.createElement('div');
            dot.className = 'level-dot';
            if (i < gameState.currentLevel - 1) {
                dot.classList.add('completed');
            }
            levelsDots.appendChild(dot);
        }
    }
    
    // Update lives
    const livesPanel = document.getElementById('livesPanel');
    if (livesPanel) {
        livesPanel.innerHTML = '';
        for (let i = 0; i < gameState.maxWrongGuesses; i++) {
            const lifeBox = document.createElement('div');
            lifeBox.className = 'life-box';
            if (i < gameState.wrongGuesses) {
                lifeBox.textContent = 'X';
                lifeBox.classList.add('lost');
            }
            livesPanel.appendChild(lifeBox);
        }
    }
    
    // Update lifelines
    updateLifelineUI();
    
    // Update timer
    updateTimerDisplay();
    
    // Update category
    const categoryEl = document.getElementById('categoryText');
    if (categoryEl) categoryEl.textContent = gameState.currentCategory;
}

function updateLifelineUI() {
    const bulbs = document.querySelectorAll('.lifeline-bulb');
    gameState.lifelinesUsed.forEach((used, index) => {
        const bulb = bulbs[index];
        if (!bulb) return;
        bulb.className = `lifeline-bulb ${used ? 'used' : 'active'}`;
        bulb.disabled = used || gameState.phase !== 'active';
        bulb.setAttribute('aria-label', used ? `Lifeline ${index + 1} used` : `Use lifeline ${index + 1}`);
        bulb.onclick = () => window.useLifeline(index);
    });
}

function updateTimerDisplay() {
    const minutes = Math.floor(gameState.timeRemaining / 60);
    const seconds = gameState.timeRemaining % 60;
    
    const minutesEl = document.getElementById('timerMinutes');
    const secondsEl = document.getElementById('timerSeconds');
    
    if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
    if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');
}

function startTimer() {
    stopTimer();
    const tick = () => {
        gameState.timeRemaining = Math.max(0, Math.ceil((gameState.deadline - Date.now()) / 1000));
        updateTimerDisplay();
        if (gameState.timeRemaining === 0) {
            stopTimer();
            if (isHost && gameState.gameResult === 'none') gameLost();
        }
    };
    tick();
    if (gameState.timeRemaining > 0) timerInterval = setInterval(tick, 250);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function displayPhrase() {
    const grid = document.getElementById('phraseGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const phrase = gameState.phraseDisplay;
    const letterCount = phrase.replace(/[^A-Z0-9_]/g, '').length;
    grid.classList.remove('short-phrase', 'medium-phrase', 'long-phrase', 'very-long-phrase');
    if (letterCount <= 15) grid.classList.add('short-phrase');
    else if (letterCount <= 25) grid.classList.add('medium-phrase');
    else if (letterCount <= 35) grid.classList.add('long-phrase');
    else grid.classList.add('very-long-phrase');

    phrase.split(' ').forEach((word, wordIndex, words) => {
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word-container';
        for (const character of word) {
            const tile = document.createElement('div');
            tile.className = 'phrase-tile';
            if (character === '_') {
                tile.setAttribute('aria-label', 'hidden character');
            } else if (/[A-Z0-9]/.test(character)) {
                tile.textContent = character;
                tile.classList.add('revealed');
            } else {
                tile.textContent = character;
                tile.classList.add('punctuation');
            }
            wordContainer.appendChild(tile);
        }
        grid.appendChild(wordContainer);
        if (wordIndex < words.length - 1) {
            const spaceTile = document.createElement('div');
            spaceTile.className = 'phrase-tile space';
            grid.appendChild(spaceTile);
        }
    });
}

function createKeyboard() {
    const allKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
    const keyboard = document.getElementById('keyboardCombined');
    if (!keyboard) return;
    keyboard.innerHTML = '';

    for (const key of allKeys) {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = key;
        btn.setAttribute('aria-label', `Guess ${key}`);
        btn.onclick = () => window.guessLetter(key, btn);
        if (gameState.guessedLetters.has(key) || pendingLetters.has(key) || gameState.phase !== 'active') {
            btn.disabled = true;
            if (gameState.guessedLetters.has(key)) {
                btn.classList.add(gameState.correctLetters.has(key) ? 'correct' : 'wrong');
            }
        }
        keyboard.appendChild(btn);
    }
}

window.guessLetter = async function(letter, keyElement) {
    if (!roomCode || gameState.phase !== 'active' || gameState.guessedLetters.has(letter) || pendingLetters.has(letter)) return;
    pendingLetters.add(letter);
    keyElement.disabled = true;
    try {
        await submitGameAction(roomCode, { type: 'guess', letter });
    } catch (error) {
        pendingLetters.delete(letter);
        keyElement.disabled = false;
        console.error('Failed to submit guess:', error);
        showToast('Guess could not be sent', true);
    }
};

window.useLifeline = async function(index) {
    if (!roomCode || gameState.phase !== 'active' || gameState.lifelinesUsed[index]) return;
    const bulb = document.querySelectorAll('.lifeline-bulb')[index];
    if (bulb) bulb.disabled = true;
    try {
        await submitGameAction(roomCode, { type: 'lifeline', lifelineIndex: index });
    } catch (error) {
        if (bulb) bulb.disabled = false;
        console.error('Failed to submit lifeline:', error);
        showToast('Lifeline could not be sent', true);
    }
};

function enqueueHostAction(actionId, action) {
    actionQueue = actionQueue
        .then(() => processHostAction(actionId, action))
        .catch(error => console.error('Failed to process game action:', error));
}

async function processHostAction(actionId, action) {
    try {
        if (!isHost || !hostPhraseDeck.length) return;
        const transaction = await transactGameState(roomCode, firebaseState => {
            const state = deserializeGameState(firebaseState);
            if (state.gameResult !== 'none' || state.phase !== 'active' || Date.now() >= state.deadline) return undefined;
            const answer = hostPhraseDeck[state.currentPhraseIndex]?.text?.toUpperCase();
            if (!answer) return undefined;

            let accepted = false;
            if (action.type === 'guess' && /^[A-Z1-4]$/.test(action.letter) && !state.guessedLetters.has(action.letter)) {
                state.guessedLetters.add(action.letter);
                accepted = true;
                if (answer.includes(action.letter)) {
                    state.correctLetters.add(action.letter);
                    state.phraseDisplay = revealLetter(answer, state.phraseDisplay, action.letter);
                    state.lastAction = 'correct';
                } else {
                    state.wrongGuesses += 1;
                    state.lastAction = 'wrong';
                }
            } else if (action.type === 'lifeline' && Number.isInteger(action.lifelineIndex)
                && action.lifelineIndex >= 0 && action.lifelineIndex < 3 && !state.lifelinesUsed[action.lifelineIndex]) {
                const options = [...new Set(answer.match(/[A-Z0-9]/g) || [])]
                    .filter(letter => !state.correctLetters.has(letter));
                if (options.length) {
                    const letter = options[Math.floor(Math.random() * options.length)];
                    state.lifelinesUsed[action.lifelineIndex] = true;
                    state.lifelinesRemaining -= 1;
                    state.guessedLetters.add(letter);
                    state.correctLetters.add(letter);
                    state.phraseDisplay = revealLetter(answer, state.phraseDisplay, letter);
                    state.lastAction = 'lifeline';
                    accepted = true;
                }
            }

            if (!accepted) return undefined;
            state.lastActorUid = action.actorUid;
            state.lastActionId = Math.max(Date.now(), state.lastActionId + 1);
            state.revision += 1;

            if (state.wrongGuesses >= state.maxWrongGuesses) {
                state.phraseDisplay = answer;
                state.gameResult = 'lost';
                state.phase = 'finished';
            } else if (!state.phraseDisplay.includes('_')) {
                state.score += 500 + (state.maxWrongGuesses - state.wrongGuesses) * 100;
                state.lastAction = 'levelComplete';
                if (state.currentLevel >= state.maxLevels) {
                    state.gameResult = 'won';
                    state.phase = 'finished';
                } else {
                    state.phase = 'levelComplete';
                    state.advanceAt = Date.now() + 3000;
                }
            }
            return serializeGameState(state);
        });

        const committedState = transaction.snapshot.val();
        if (transaction.committed && committedState?.gameResult !== 'none') {
            await firebaseEndGame(roomCode, committedState);
        }
    } finally {
        await removeGameAction(roomCode, actionId).catch(() => {});
    }
}

function scheduleLevelAdvance() {
    if (!isHost || levelAdvanceTimer || gameState.phase !== 'levelComplete') return;
    const delay = Math.max(0, gameState.advanceAt - Date.now());
    levelAdvanceTimer = setTimeout(async () => {
        levelAdvanceTimer = null;
        await nextLevel();
    }, delay);
}

async function nextLevel() {
    if (!isHost) return;
    await transactGameState(roomCode, firebaseState => {
        const state = deserializeGameState(firebaseState);
        if (state.phase !== 'levelComplete' || state.gameResult !== 'none') return undefined;
        const nextIndex = state.currentPhraseIndex + 1;
        const phraseData = hostPhraseDeck[nextIndex];
        if (!phraseData) return undefined;
        state.currentLevel += 1;
        state.currentPhraseIndex = nextIndex;
        state.phraseDisplay = maskPhrase(phraseData.text);
        state.currentCategory = phraseData.category;
        state.guessedLetters = new Set();
        state.correctLetters = new Set();
        state.wrongGuesses = 0;
        state.phase = 'active';
        state.advanceAt = 0;
        state.lastAction = 'none';
        state.revision += 1;
        return serializeGameState(state);
    });
}

async function gameLost() {
    if (!isHost || gameState.gameResult !== 'none') return;
    const transaction = await transactGameState(roomCode, firebaseState => {
        const state = deserializeGameState(firebaseState);
        if (state.gameResult !== 'none') return undefined;
        const answer = hostPhraseDeck[state.currentPhraseIndex]?.text?.toUpperCase();
        if (!answer) return undefined;
        state.phraseDisplay = answer;
        state.gameResult = 'lost';
        state.phase = 'finished';
        state.advanceAt = 0;
        state.lastActionId = Math.max(Date.now(), state.lastActionId + 1);
        state.lastActorUid = playerUid;
        state.revision += 1;
        return serializeGameState(state);
    });
    if (transaction.committed) await firebaseEndGame(roomCode, transaction.snapshot.val());
}

function showGameOver(won) {
    console.log('[ShowGameOver] Called with won:', won, 'IsHost:', isHost);
    stopTimer();
    const content = document.getElementById('gameOverContent');
    if (!content) {
        console.error('[ShowGameOver] gameOverContent element not found!');
        return;
    }
    
    if (won) {
        content.innerHTML = `
            <h2 class="win">🎉 Congratulations! 🎉</h2>
            <p style="font-size: 1rem; margin: 8px 0; color: #333; line-height: 1.2;">You completed all ${gameState.maxLevels} levels!</p>
            <div class="final-score">Final Score: <span style="color: #0066CC;">${gameState.score}</span></div>
            <div class="gameover-buttons">
                <button class="gameover-btn" onclick="exitToMenu()">
                    <span>🏠</span> Main Menu
                </button>
            </div>
        `;
    } else {
        content.innerHTML = `
            <h2 class="lose">😢 Game Over</h2>
            <p style="font-size: 1rem; margin: 8px 0; color: #333; font-weight: bold; line-height: 1.2;">The phrase was:</p>
            <div class="revealed-phrase">${gameState.phraseDisplay}</div>
            <p style="font-size: 1rem; margin: 8px 0; color: #333; font-weight: bold; line-height: 1.2;">Level Reached: ${gameState.currentLevel}</p>
            <div class="final-score">Final Score: <span style="color: #0066CC;">${gameState.score}</span></div>
            <div class="gameover-buttons">
                <button class="gameover-btn" onclick="exitToMenu()">
                    <span>🏠</span> Main Menu
                </button>
            </div>
        `;
    }
    
    console.log('[ShowGameOver] Calling showScreen(gameOverScreen)');
    showScreen('gameOverScreen');
    console.log('[ShowGameOver] Screen switched');
}

window.exitToMenu = async function() {
    if (roomCode) {
        try {
            if (isHost) await deleteRoom(roomCode);
            else await firebaseRemovePlayer(roomCode, playerIndex);
        } catch (error) {
            console.error('Failed to leave room:', error);
        }
    }
    window.showMenu();
};

window.quitGame = async function() {
    if (roomCode) {
        try {
            if (isHost) await deleteRoom(roomCode);
            else await firebaseRemovePlayer(roomCode, playerIndex);
        } catch (error) {
            console.error('Failed to leave room:', error);
        }
    }
    window.showMenu();
};

// ========== PHRASE LOADER ==========
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function loadAndShufflePhrases() {
    try {
        const response = await fetch('Bollywood.xml.txt');
        if (!response.ok) {
            throw new Error('Failed to load phrases');
        }
        
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        const categories = xmlDoc.getElementsByTagName('category');
        const selectedPhrases = [];
        const phrasesPerCategory = 3;
        
        // Load phrases from each category
        for (let category of categories) {
            const categoryName = category.getAttribute('name');
            const phraseElements = category.getElementsByTagName('phrase');
            const categoryPhrases = [];
            
            // Collect all phrases from this category
            for (let phrase of phraseElements) {
                categoryPhrases.push({
                    text: phrase.textContent.trim(),
                    category: categoryName
                });
            }
            
            // Shuffle once
            const shuffled = shuffleArray(categoryPhrases);
            
            // Use random offset to pick from different positions each time
            const maxOffset = Math.max(0, shuffled.length - phrasesPerCategory);
            const startOffset = Math.floor(Math.random() * (maxOffset + 1));
            
            // Take phrases from random position
            for (let i = 0; i < phrasesPerCategory && (startOffset + i) < shuffled.length; i++) {
                selectedPhrases.push(shuffled[startOffset + i]);
            }
        }
        
        if (selectedPhrases.length === 0) {
            throw new Error('No phrases found');
        }
        
        // Shuffle once to mix categories
        const finalShuffled = shuffleArray(selectedPhrases);
        
        // Take first 10 for the game
        return finalShuffled.slice(0, 10);
        
    } catch (error) {
        console.error('Failed to load phrases:', error);
        // Fallback phrases
        return [
            { text: 'Shah Rukh Khan', category: 'ACTORS' },
            { text: 'Salman Khan', category: 'ACTORS' },
            { text: 'Aamir Khan', category: 'ACTORS' },
            { text: 'Deepika Padukone', category: 'ACTRESSES' },
            { text: 'Alia Bhatt', category: 'ACTRESSES' },
            { text: 'Katrina Kaif', category: 'ACTRESSES' },
            { text: 'Dilwale Dulhania Le Jayenge', category: 'FILMS' },
            { text: 'Three Idiots', category: 'FILMS' },
            { text: 'Dangal', category: 'FILMS' },
            { text: 'Sholay', category: 'FILMS' }
        ];
    }
}

// ========== MUTE TOGGLE ==========
const muteBtn = document.getElementById('muteBtn');
if (muteBtn) {
    const updateMuteButton = (muted) => {
        muteBtn.textContent = muted ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    };
    updateMuteButton(AudioManager.isMuted());
    muteBtn.addEventListener('click', () => updateMuteButton(AudioManager.toggleMute()));
}

console.log('Bollywood Beats Multiplayer loaded successfully!');


// ========== SESSION RESTORATION ==========
async function restoreSession() {
    const session = loadSession();
    if (!session) return false;

    try {
        const restored = await restoreConnection(session.roomCode, session.playerIndex);
        if (session.playerUid !== restored.uid) throw new Error('Saved session identity changed');
        roomCode = session.roomCode;
        playerIndex = session.playerIndex;
        playerUid = restored.uid;
        isHost = playerIndex === 0 && restored.meta.hostUid === restored.uid;
        cancelDisconnect = async () => cancelDisconnectHandler(roomCode, playerIndex);

        if (isHost && restored.meta.status === 'playing') {
            hostPhraseDeck = await getHostPhraseDeck(roomCode);
        }

        saveSession();
        startLobbyListener();
        if (restored.meta.status === 'lobby') {
            showLobby();
            showToast('Reconnected to lobby');
            return true;
        }
        if (restored.meta.status === 'playing' && restored.game) {
            updateGameFromFirebase(restored.game);
            showScreen('gameScreen');
            startTimer();
            AudioManager.startBackgroundMusic(0.15);
            showToast('Reconnected to game');
            return true;
        }
        throw new Error('Unsupported room state');
    } catch (error) {
        console.error('Failed to restore session:', error);
        clearSession();
        return false;
    }
}

// ========== INITIALIZATION ==========
// Try to restore session on page load
(async function() {
    // Check for deep link with room code first
    const deepLinkRoomCode = initDeepLinkHandler({
        roomInputId: 'roomCodeInput',
        joinScreenId: 'joinRoomScreen',
        gameName: 'Bollywood Beats'
    });
    
    // If deep link present, show join screen and return
    if (deepLinkRoomCode) {
        showScreen('joinRoomScreen');
        return;
    }
    
    // Try to restore existing session
    const restored = await restoreSession();
    if (!restored) {
        showScreen('menuScreen');
    }
})();
