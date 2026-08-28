/**
 * Bollywood Beats - Multiplayer Version
 * Real-time collaborative phrase guessing game
 */

import {
  ROOM_CODE_PATTERN,
  acknowledgeFinalReveal,
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
import { authReady } from './firebase-config.js';
import { mountVoiceChat } from './voice-chat-widget.js';

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
    let backgroundMusicRequested = false;
    let backgroundMusicVolume = 0.15;
    let currentSoundEffect = null;
    const speechSynthesis = window.speechSynthesis;
    let activeUtterance = null; // Keep mobile browsers from garbage-collecting it.
    let isSpeaking = false; // Track if speech is in progress
    let speechQueue = []; // Queue for pending speech
    let voicesLoaded = false;
    const speechSupported = Boolean(speechSynthesis);

    // Mobile browsers often expose voices late. An empty voice list does not
    // mean synthesis is unsupported; the browser can still use its default.
    if (speechSynthesis) {
        const refreshVoices = () => {
            const voices = speechSynthesis.getVoices();
            voicesLoaded = voices.length > 0;
        };
        speechSynthesis.onvoiceschanged = refreshVoices;
        refreshVoices();
        setTimeout(refreshVoices, 500);
        setTimeout(refreshVoices, 1500);
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
            showIdleCharacter();
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
            
            audio.play().catch(error => {
                console.warn(`[AudioManager] Failed to play ${name}`, error);
            });
        } catch (error) {
            console.error(`[AudioManager] Could not create ${name} audio`, error);
        }
    }

    function finishSpeechStep(onComplete) {
        showIdleCharacter();
        if (typeof onComplete === 'function') {
            setTimeout(onComplete, 100);
        } else {
            resumeBackgroundMusic();
        }
    }

    function speak(text, rate = 1.0, pitch = 1.1, onComplete = null) {
        if (isMuted()) {
            finishSpeechStep(onComplete);
            return;
        }
        
        // If speech not supported, just show visual animation
        if (!speechSynthesis || !speechSupported) {
            finishSpeechStep(onComplete);
            return;
        }

        // Mobile browsers often cannot mix an HTMLAudio effect and synthesized
        // speech. Wait for the short effect to finish before claiming audio focus.
        const activeEffect = currentSoundEffect;
        if (activeEffect && !activeEffect.paused && !activeEffect.ended) {
            let continued = false;
            const continueSpeech = () => {
                if (continued) return;
                continued = true;
                activeEffect.removeEventListener('ended', continueSpeech);
                activeEffect.removeEventListener('error', continueSpeech);
                speak(text, rate, pitch, onComplete);
            };
            activeEffect.addEventListener('ended', continueSpeech, { once: true });
            activeEffect.addEventListener('error', continueSpeech, { once: true });
            setTimeout(continueSpeech, 5000);
            return;
        }
        
        // If already speaking, queue this speech to play after current one finishes
        if (isSpeaking) {
            speechQueue.push({ text, rate, pitch, onComplete });
            return;
        }
        
        try {
            // Keep the looping game music active while effects and synthesized
            // speech play over it. Some mobile systems may temporarily duck the
            // volume, but the app must never explicitly pause the music here.
            // Cancel only after the effect has finished, then start a fresh utterance.
            speechSynthesis.cancel();
            
            isSpeaking = true;
            let speechStarted = false;
            let speechEnded = false;
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = 1.0;
            utterance.lang = 'en-US';
            activeUtterance = utterance;
            
            // Select voice if available
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                const englishVoice = voices.find(v => v.lang.startsWith('en-')) || voices[0];
                utterance.voice = englishVoice;
                voicesLoaded = true;
            }
            
            // Track when speech actually starts
            utterance.onstart = () => {
                speechStarted = true;
                showTalkingCharacter();
            };
            
            // When speech ends, check queue and play next or switch to idle
            utterance.onend = () => {
                // Prevent double-firing of end event
                if (speechEnded) return;
                speechEnded = true;
                if (activeUtterance === utterance) activeUtterance = null;
                
                // Only process end if speech actually started
                if (!speechStarted) {
                    isSpeaking = false;
                    finishSpeechStep(onComplete);
                    return;
                }
                
                isSpeaking = false;
                
                if (typeof onComplete === 'function') {
                    finishSpeechStep(onComplete);
                } else if (speechQueue.length > 0) {
                    const nextSpeech = speechQueue.shift();
                    showIdleCharacter();
                    setTimeout(() => speak(
                        nextSpeech.text,
                        nextSpeech.rate,
                        nextSpeech.pitch,
                        nextSpeech.onComplete,
                    ), 100);
                } else {
                    finishSpeechStep(null);
                }
            };
            
            utterance.onerror = (err) => {
                console.error('[Speech] Speech error:', err.error, err);
                speechEnded = true;
                if (activeUtterance === utterance) activeUtterance = null;
                isSpeaking = false;
                speechQueue = [];
                finishSpeechStep(onComplete);
            };
            
            // Keep idle visible while the mobile TTS engine initializes.
            // The talking video starts only after the actual onstart event.
            showIdleCharacter();
            
            // Give mobile engines a brief moment after cancel(), then resume
            // the speech queue before submitting the retained utterance.
            setTimeout(() => {
                if (speechEnded) return;
                speechSynthesis.resume();
                speechSynthesis.speak(utterance);
            }, 100);
            
            // Mobile TTS services can cold-start slowly; do not cancel at 1s.
            setTimeout(() => {
                if (!speechStarted && !speechEnded && isSpeaking && activeUtterance === utterance) {
                    speechEnded = true;
                    isSpeaking = false;
                    activeUtterance = null;
                    speechSynthesis.cancel();

                    if (typeof onComplete === 'function') {
                        finishSpeechStep(onComplete);
                    } else if (speechQueue.length > 0) {
                        const nextSpeech = speechQueue.shift();
                        showIdleCharacter();
                        speak(nextSpeech.text, nextSpeech.rate, nextSpeech.pitch, nextSpeech.onComplete);
                    } else {
                        finishSpeechStep(null);
                    }
                }
            }, 5000);
            
        } catch (err) {
            console.error('[Speech] Speech synthesis error:', err);
            activeUtterance = null;
            isSpeaking = false;
            speechQueue = [];
            finishSpeechStep(onComplete);
        }
    }
    
    function showTalkingCharacter() {
        const idleVideo = document.getElementById('characterIdle');
        const talkingVideo = document.getElementById('characterTalking');
        
        if (!idleVideo || !talkingVideo) return;
        
        // Hide and pause idle video without waiting
        if (idleVideo.style.display !== 'none') {
            idleVideo.style.display = 'none';
            idleVideo.pause();
        }
        
        // Show and play talking video WITH loop (keeps playing until speech ends).
        // Always retry play(): mobile browsers may defer playback while hidden.
        talkingVideo.style.display = 'block';
        talkingVideo.loop = true;
        if (talkingVideo.paused) talkingVideo.currentTime = 0;
        talkingVideo.play().catch(err => {
            console.error('[Character] Failed to play talking video:', err);
        });
    }
    
    function showIdleCharacter() {
        const idleVideo = document.getElementById('characterIdle');
        const talkingVideo = document.getElementById('characterTalking');
        
        if (!idleVideo || !talkingVideo) return;
        
        // Hide and pause talking video immediately (no delay)
        if (talkingVideo.style.display !== 'none') {
            talkingVideo.style.display = 'none';
            talkingVideo.pause();
        }
        
        // Show and play idle video immediately. Always retry play() because
        // autoplay may have been deferred while the game screen was hidden.
        idleVideo.style.display = 'block';
        if (idleVideo.paused) idleVideo.currentTime = 0;
        idleVideo.play().catch(err => {
            console.error('[Character] Failed to play idle video:', err);
        });
    }

    function playRandomEncourage() {
        const phrases = SpeechPhrases.encourage;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 1.1, 1.2);
    }

    function playRandomDisappoint() {
        const phrases = SpeechPhrases.disappoint;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 0.95, 0.9);
    }

    function playRandomLevelComplete(onComplete = null) {
        const phrases = SpeechPhrases.levelComplete;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 1.15, 1.3, onComplete);
    }

    function playLevelCompleteSequence(onComplete = null) {
        const phrases = SpeechPhrases.encourage;
        const encouragement = phrases[Math.floor(Math.random() * phrases.length)];
        playSound('correct');
        speak(encouragement, 1.1, 1.2, () => {
            playSound('win', 0.25);
            playRandomLevelComplete(() => {
                resumeBackgroundMusic();
                onComplete?.();
            });
        });
    }

    function ensureBackgroundMusic() {
        if (backgroundMusic) return backgroundMusic;
        backgroundMusic = new Audio(SOUND_FILES.music);
        backgroundMusic.loop = true;
        backgroundMusic.preload = 'auto';
        backgroundMusic.style.display = 'none';
        return backgroundMusic;
    }

    function startBackgroundMusic(volume = 0.15) {
        backgroundMusicRequested = true;
        backgroundMusicVolume = volume;
        if (isMuted()) return;

        try {
            const music = ensureBackgroundMusic();
            music.muted = false;
            music.volume = volume;
            const playPromise = music.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(error => {
                    console.warn('Background music playback was blocked; it will retry on the next game control', error);
                });
            }
        } catch (error) {
            console.error('Failed to start background music:', error);
        }
    }

    function stopBackgroundMusic() {
        backgroundMusicRequested = false;
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
        if (!backgroundMusicRequested || isMuted()) return;
        startBackgroundMusic(backgroundMusicVolume);
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
        playLevelCompleteSequence,
        toggleMute,
        isMuted,
        startBackgroundMusic,
        resumeBackgroundMusic,
        stopBackgroundMusic,
        stopSoundEffects,
        showIdleCharacter,
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
let levelAdvanceInFlight = false;
let finalRevealAckRetryTimer = null;
let finalRevealAckScheduledId = 0;
let acknowledgedFinalRevealId = 0;
let latestPlayers = {};

/* Lobby presence: a dropped player lingers briefly with the offline dot, then is
   pruned. The host (player_0) and the local player are never hidden. */
const LOBBY_PRUNE_DELAY_MS = 2500;
let lobbyDisconnectedSince = {};
let lobbyPruneTimer = null;
let latestFinalRevealAcks = {};
let finalizationInFlight = false;
let finalizationRetryTimer = null;
let finalFeedbackId = 0;
let finalFeedbackCompleteId = 0;
let hostPhraseDeck = [];
let actionQueue = Promise.resolve();
let voiceWidget = null;
const pendingLetters = new Set();

/**
 * Mounts the standardized voice-chat widget once we're in a room and on the
 * game screen. Idempotent — safe to call on every game-screen entry. Voice is
 * opt-in and isolated; any failure only updates the widget button.
 */
function mountVoice() {
    if (voiceWidget || roomCode == null || playerIndex == null) return;
    voiceWidget = mountVoiceChat({
        mount: '#voice-widget',
        game: 'bollywoodbeats',
        getRoomCode: () => roomCode,
        getIdentity: () => (playerIndex != null ? `player_${playerIndex}` : null),
        getDisplayName: () => latestPlayers?.[`player_${playerIndex}`]?.name || 'Player',
        getIdToken: async () => (await authReady).getIdToken(),
        notify: (message) => showToast(message, true),
    });
}

function stopVoice() {
    if (voiceWidget) {
        try { voiceWidget.stop(); } catch (_) {}
    }
}

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
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        if (screenId === 'gameScreen') {
            requestAnimationFrame(() => AudioManager.showIdleCharacter());
        }
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
    if (!loader) return;
    const textEl = loader.querySelector('.loading-text');
    const spinner = loader.querySelector('.loading-spinner');
    const dismissButton = loader.querySelector('.loading-error-action');
    if (textEl) textEl.textContent = message;
    if (spinner) spinner.hidden = false;
    if (dismissButton) dismissButton.hidden = true;
    loader.classList.remove('error');
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.setAttribute('aria-label', 'Loading');
    loader.setAttribute('aria-busy', 'true');
    loader.style.display = 'flex';
}

function showLoadingError(message) {
    const loader = document.getElementById('loadingOverlay');
    if (!loader) {
        showToast(message, true);
        return;
    }
    const textEl = loader.querySelector('.loading-text');
    const spinner = loader.querySelector('.loading-spinner');
    const dismissButton = loader.querySelector('.loading-error-action');
    if (textEl) textEl.textContent = message;
    if (spinner) spinner.hidden = true;
    if (dismissButton) {
        dismissButton.hidden = false;
        dismissButton.onclick = hideLoading;
    }
    loader.classList.add('error');
    loader.setAttribute('role', 'alert');
    loader.setAttribute('aria-live', 'assertive');
    loader.setAttribute('aria-label', 'Phrase loading error');
    loader.setAttribute('aria-busy', 'false');
    loader.style.display = 'flex';
    requestAnimationFrame(() => dismissButton?.focus());
}

function hideLoading() {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.setAttribute('aria-busy', 'false');
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
    if (finalRevealAckRetryTimer) {
        clearTimeout(finalRevealAckRetryTimer);
        finalRevealAckRetryTimer = null;
    }
    if (finalizationRetryTimer) {
        clearTimeout(finalizationRetryTimer);
        finalizationRetryTimer = null;
    }
    levelAdvanceInFlight = false;
    finalRevealAckScheduledId = 0;
    acknowledgedFinalRevealId = 0;
    latestPlayers = {};
    latestFinalRevealAcks = {};
    finalizationInFlight = false;
    finalFeedbackId = 0;
    finalFeedbackCompleteId = 0;
    AudioManager.stopBackgroundMusic();
    stopVoice();
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
    latestPlayers = {};
    latestFinalRevealAcks = {};

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
            latestPlayers = players;
            updatePlayersList(players);
            const host = players.player_0;
            if (!isHost && host && !host.connected) {
                showToast('Host disconnected — game will resume when the host returns', true);
            }
            maybeFinalizeWin();
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
                    AudioManager.startBackgroundMusic(0.15);
                    mountVoice();
                }
                if (game.phase === 'active') startTimer();
                else stopTimer();
            }
        },
        onFinalRevealAcksChange: isHost ? (acks) => {
            latestFinalRevealAcks = acks;
            maybeFinalizeWin();
        } : undefined,
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

/** Connected players, the host (player_0), and the local player always show; a
    dropped player lingers with the offline dot, then is pruned. */
function isBBPlayerVisible(key, player) {
    if (player?.connected !== false) return true;
    if (key === 'player_0' || key === `player_${playerIndex}`) return true;
    const since = lobbyDisconnectedSince[key];
    return typeof since === 'number' && Date.now() - since < LOBBY_PRUNE_DELAY_MS;
}

/** Track when each player first went offline so a dropped row can linger then prune. */
function trackBBDisconnections(players) {
    const stamp = Date.now();
    const next = {};
    let pruneNeeded = false;
    Object.keys(players).forEach((key) => {
        if (players[key]?.name && players[key]?.connected === false) {
            next[key] = lobbyDisconnectedSince[key] || stamp;
            const prunable = key !== 'player_0' && key !== `player_${playerIndex}`;
            if (prunable && stamp - next[key] < LOBBY_PRUNE_DELAY_MS) pruneNeeded = true;
        }
    });
    lobbyDisconnectedSince = next;
    if (!pruneNeeded || lobbyPruneTimer !== null) return;
    lobbyPruneTimer = setTimeout(() => {
        lobbyPruneTimer = null;
        updatePlayersList(latestPlayers);
    }, LOBBY_PRUNE_DELAY_MS);
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

    trackBBDisconnections(players);
    // Only named players are real; no-name nodes are stale onDisconnect ghosts.
    const namedEntries = Object.entries(players).filter(([, player]) => player && player.name);
    const playerEntries = namedEntries
        .filter(([key, player]) => isBBPlayerVisible(key, player))
        .sort((a, b) => parseInt(a[0].split('_')[1]) - parseInt(b[0].split('_')[1]));

    const connectedCount = namedEntries.filter(([, player]) => player.connected !== false).length;
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn && isHost) startBtn.disabled = connectedCount < 1;

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

    const connectedCount = Object.values(latestPlayers).filter((p) => p?.name && p?.connected !== false).length;
    if (connectedCount < 1) {
        showToast('Waiting for players to connect…', true);
        return;
    }

    // Start during the trusted button gesture so mobile autoplay policies allow it.
    AudioManager.startBackgroundMusic(0.15);

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
        console.log('[Game] Final 10 phrases:\n' + hostPhraseDeck
            .map((phrase, index) => `${index + 1}. ${phrase.text} (${phrase.category})`)
            .join('\n'));
        recordPhraseUsage(hostPhraseDeck);
        hideLoading();
    } catch (error) {
        AudioManager.stopBackgroundMusic();
        hostPhraseDeck = [];
        console.error('Failed to start game:', error);
        if (error?.code === 'PHRASE_LOAD_FAILED') {
            showLoadingError('Phrases could not be loaded. Please check your connection and try again.');
        } else {
            hideLoading();
            showToast('Failed to start game. Please try again.', true);
        }
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

function maybeShowFinalWin() {
    if (gameState.phase !== 'finished' || gameState.gameResult !== 'won') return;
    const revealId = gameState.lastActionId;
    if (finalFeedbackId === revealId && finalFeedbackCompleteId !== revealId) return;
    if (document.querySelector('.screen.active')?.id !== 'gameOverScreen') showGameOver(true);
}

function scheduleFinalRevealAcknowledgement() {
    const revealId = gameState.lastActionId;
    if (!roomCode || !playerUid || gameState.phase !== 'finalReveal'
        || !Number.isSafeInteger(revealId) || revealId <= 0
        || acknowledgedFinalRevealId === revealId || finalRevealAckScheduledId === revealId) return;

    const expectedRoomCode = roomCode;
    finalRevealAckScheduledId = revealId;
    requestAnimationFrame(() => requestAnimationFrame(async () => {
        if (roomCode !== expectedRoomCode || gameState.phase !== 'finalReveal'
            || gameState.lastActionId !== revealId) {
            if (finalRevealAckScheduledId === revealId) finalRevealAckScheduledId = 0;
            return;
        }

        const levelDots = document.querySelectorAll('#levelsDots .level-dot');
        const finalLevelDot = levelDots[levelDots.length - 1];
        if (levelDots.length !== gameState.maxLevels || !finalLevelDot?.classList.contains('completed')) {
            if (finalRevealAckScheduledId === revealId) finalRevealAckScheduledId = 0;
            requestAnimationFrame(() => scheduleFinalRevealAcknowledgement());
            return;
        }

        try {
            await acknowledgeFinalReveal(expectedRoomCode, revealId);
            acknowledgedFinalRevealId = revealId;
        } catch (error) {
            console.error('Failed to acknowledge final phrase render:', error);
            if (!finalRevealAckRetryTimer) {
                finalRevealAckRetryTimer = setTimeout(() => {
                    finalRevealAckRetryTimer = null;
                    scheduleFinalRevealAcknowledgement();
                }, 1000);
            }
        } finally {
            if (finalRevealAckScheduledId === revealId) finalRevealAckScheduledId = 0;
        }
    }));
}

function connectedPlayerUids() {
    const uids = Object.values(latestPlayers)
        .filter(player => player?.connected === true)
        .map(player => player.uid)
        .filter(uid => typeof uid === 'string' && uid.length > 0);
    return [...new Set(uids)];
}

function scheduleFinalizationRetry() {
    if (finalizationRetryTimer || gameState.phase !== 'finalReveal') return;
    finalizationRetryTimer = setTimeout(() => {
        finalizationRetryTimer = null;
        maybeFinalizeWin();
    }, 1000);
}

function maybeFinalizeWin() {
    const revealId = gameState.lastActionId;
    if (!isHost || !roomCode || finalizationInFlight || gameState.phase !== 'finalReveal'
        || gameState.gameResult !== 'none' || !Number.isSafeInteger(revealId) || revealId <= 0) return;

    const connectedUids = connectedPlayerUids();
    if (!connectedUids.length || !connectedUids.every(uid => latestFinalRevealAcks[uid] === revealId)) return;

    const expectedRoomCode = roomCode;
    finalizationInFlight = true;
    transactGameState(expectedRoomCode, firebaseState => {
        const state = deserializeGameState(firebaseState);
        if (state.phase !== 'finalReveal' || state.gameResult !== 'none'
            || state.lastActionId !== revealId) return undefined;
        state.gameResult = 'won';
        state.phase = 'finished';
        state.advanceAt = 0;
        state.revision += 1;
        return serializeGameState(state);
    }).then(async transaction => {
        if (transaction.committed) {
            await firebaseEndGame(expectedRoomCode, transaction.snapshot.val());
        } else if (roomCode === expectedRoomCode && gameState.phase === 'finalReveal') {
            scheduleFinalizationRetry();
        }
    }).catch(error => {
        console.error('Failed to finalize acknowledged win:', error);
        if (roomCode === expectedRoomCode) scheduleFinalizationRetry();
    }).finally(() => {
        finalizationInFlight = false;
    });
}

function updateGameFromFirebase(firebaseGameState) {
    if (!firebaseGameState) return;
    const hadPreviousAction = previousActionId !== 0;
    gameState = deserializeGameState(firebaseGameState);
    for (const letter of gameState.guessedLetters) pendingLetters.delete(letter);

    if (gameState.lastActionId !== previousActionId) {
        previousActionId = gameState.lastActionId;
        const isFinalReveal = gameState.phase === 'finalReveal' && gameState.lastAction === 'levelComplete';
        if (hadPreviousAction || isFinalReveal) {
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
                case 'levelComplete': {
                    const completedRoomCode = roomCode;
                    const completedActionId = gameState.lastActionId;
                    if (isFinalReveal) {
                        finalFeedbackId = completedActionId;
                        finalFeedbackCompleteId = 0;
                    }
                    AudioManager.playLevelCompleteSequence(() => {
                        // Ignore a late media callback after leaving this room.
                        if (roomCode !== completedRoomCode || gameState.lastActionId !== completedActionId) return;
                        if (isFinalReveal) {
                            finalFeedbackCompleteId = completedActionId;
                            maybeShowFinalWin();
                        } else if (isHost) {
                            requestLevelAdvance();
                        }
                    });
                    break;
                }
            }
        }
    }

    updateGameUI();
    displayPhrase();
    createKeyboard();

    if (gameState.phase === 'active') {
        if (!timerInterval) startTimer();
    } else {
        stopTimer();
    }
    if (isHost && gameState.phase === 'levelComplete') scheduleLevelAdvance();
    if (gameState.phase === 'finalReveal') {
        scheduleFinalRevealAcknowledgement();
        maybeFinalizeWin();
    }

    if (gameState.gameResult === 'lost' && gameState.gameResult !== previousResult) {
        previousResult = gameState.gameResult;
        showGameOver(false);
    } else if (gameState.gameResult === 'won' && gameState.phase === 'finished') {
        previousResult = gameState.gameResult;
        maybeShowFinalWin();
    }
}

// ========== GAME UI ==========
function updateGameUI() {
    // Update score
    const scoreEl = document.getElementById('scoreDisplay');
    if (scoreEl) scoreEl.textContent = gameState.score;
    
    // Update level dots. The current dot becomes complete as soon as its
    // phrase is solved, rather than waiting for the next level to begin.
    const levelsDots = document.getElementById('levelsDots');
    if (levelsDots) {
        const currentLevelIsComplete = gameState.phase === 'levelComplete'
            || gameState.phase === 'finalReveal'
            || (gameState.phase === 'finished' && gameState.gameResult === 'won');
        const completedLevels = Math.min(
            gameState.maxLevels,
            Math.max(0, gameState.currentLevel - (currentLevelIsComplete ? 0 : 1)),
        );

        levelsDots.innerHTML = '';
        for (let i = 0; i < gameState.maxLevels; i++) {
            const dot = document.createElement('div');
            dot.className = 'level-dot';
            if (i < completedLevels) {
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
    if (gameState.phase !== 'active' || gameState.gameResult !== 'none') return;
    const tick = () => {
        if (gameState.phase !== 'active' || gameState.gameResult !== 'none') {
            stopTimer();
            return;
        }
        gameState.timeRemaining = Math.max(0, Math.ceil((gameState.deadline - Date.now()) / 1000));
        updateTimerDisplay();
        if (gameState.timeRemaining === 0) {
            stopTimer();
            if (isHost) gameLost();
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
    AudioManager.resumeBackgroundMusic();
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
    AudioManager.resumeBackgroundMusic();
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
                    // Keep the completed phrase public and visible until every
                    // currently connected player acknowledges rendering it.
                    state.gameResult = 'none';
                    state.phase = 'finalReveal';
                    state.advanceAt = 0;
                } else {
                    state.phase = 'levelComplete';
                    // Safety fallback only; the host normally advances as soon
                    // as its complete feedback sequence reports completion.
                    state.advanceAt = Date.now() + 5000;
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

function requestLevelAdvance() {
    if (!isHost || levelAdvanceInFlight || gameState.phase !== 'levelComplete') return;
    if (levelAdvanceTimer) {
        clearTimeout(levelAdvanceTimer);
        levelAdvanceTimer = null;
    }
    levelAdvanceInFlight = true;
    nextLevel()
        .catch(error => console.error('Failed to advance level:', error))
        .finally(() => {
            levelAdvanceInFlight = false;
        });
}

function scheduleLevelAdvance() {
    if (!isHost || levelAdvanceTimer || levelAdvanceInFlight || gameState.phase !== 'levelComplete') return;
    const delay = Math.max(0, gameState.advanceAt - Date.now());
    levelAdvanceTimer = setTimeout(() => {
        levelAdvanceTimer = null;
        requestLevelAdvance();
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
    if (!isHost || gameState.gameResult !== 'none' || gameState.phase !== 'active') return;
    const transaction = await transactGameState(roomCode, firebaseState => {
        const state = deserializeGameState(firebaseState);
        if (state.gameResult !== 'none' || state.phase !== 'active') return undefined;
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
    
    showScreen('gameOverScreen');
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
const PHRASE_USAGE_KEY = 'bollywood_beats_phrase_usage_v1';
let phraseUsageMemory = {};

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function phraseUsageKey(phrase) {
    return JSON.stringify([phrase.category, phrase.text.toUpperCase()]);
}

function loadPhraseUsage(phrases) {
    let storedUsage = {};
    try {
        const stored = JSON.parse(localStorage.getItem(PHRASE_USAGE_KEY) || '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) storedUsage = stored;
    } catch (error) {
        console.warn('Phrase usage history was invalid and has been reset:', error);
    }

    const currentUsage = {};
    for (const phrase of phrases) {
        const key = phraseUsageKey(phrase);
        const count = storedUsage[key];
        currentUsage[key] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }
    phraseUsageMemory = currentUsage;
    return currentUsage;
}

function selectCategoryBalanced(phrases, limit) {
    const byCategory = new Map();
    for (const phrase of shuffleArray(phrases)) {
        if (!byCategory.has(phrase.category)) byCategory.set(phrase.category, []);
        byCategory.get(phrase.category).push(phrase);
    }

    const categories = shuffleArray([...byCategory.keys()]);
    const selected = [];
    while (selected.length < limit) {
        let addedPhrase = false;
        for (const category of categories) {
            const phrase = byCategory.get(category)?.pop();
            if (!phrase) continue;
            selected.push(phrase);
            addedPhrase = true;
            if (selected.length === limit) break;
        }
        if (!addedPhrase) break;
    }
    return selected;
}

function selectLeastUsedPhrases(phrases, limit) {
    const usage = loadPhraseUsage(phrases);
    const usageBuckets = new Map();
    for (const phrase of phrases) {
        const count = usage[phraseUsageKey(phrase)];
        if (!usageBuckets.has(count)) usageBuckets.set(count, []);
        usageBuckets.get(count).push(phrase);
    }

    const selected = [];
    const counts = [...usageBuckets.keys()].sort((a, b) => a - b);
    for (const count of counts) {
        if (selected.length === limit) break;
        selected.push(...selectCategoryBalanced(usageBuckets.get(count), limit - selected.length));
    }
    return shuffleArray(selected);
}

function recordPhraseUsage(phrases) {
    for (const phrase of phrases) {
        const key = phraseUsageKey(phrase);
        phraseUsageMemory[key] = (phraseUsageMemory[key] || 0) + 1;
    }
    try {
        localStorage.setItem(PHRASE_USAGE_KEY, JSON.stringify(phraseUsageMemory));
    } catch (error) {
        console.warn('Phrase usage history could not be saved:', error);
    }
}

async function loadAndShufflePhrases() {
    try {
        const response = await fetch('Bollywood.xml.txt');
        if (!response.ok) throw new Error(`Phrase request failed with status ${response.status}`);

        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        if (xmlDoc.querySelector('parsererror')) throw new Error('Phrase XML is malformed');

        const seenPhrases = new Set();
        const validPhrases = [];
        for (const category of xmlDoc.getElementsByTagName('category')) {
            const categoryName = String(category.getAttribute('name') || '').trim();
            if (!categoryName || categoryName.length > 50) continue;

            for (const phraseElement of category.getElementsByTagName('phrase')) {
                const phraseText = phraseElement.textContent.trim();
                const phraseKey = phraseText.toUpperCase();
                if (!phraseText || phraseText.length > 100 || !/[A-Z0-9]/i.test(phraseText)
                    || seenPhrases.has(phraseKey)) continue;
                seenPhrases.add(phraseKey);
                validPhrases.push({ text: phraseText, category: categoryName });
            }
        }

        if (validPhrases.length < 10) throw new Error('Fewer than 10 valid unique phrases were found');
        return selectLeastUsedPhrases(validPhrases, 10);
    } catch (cause) {
        console.error('Failed to load or validate phrases:', cause);
        const error = new Error('Phrases could not be loaded');
        error.code = 'PHRASE_LOAD_FAILED';
        error.cause = cause;
        throw error;
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
            mountVoice();
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
