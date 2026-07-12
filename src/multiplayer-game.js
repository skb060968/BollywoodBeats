/**
 * Bollywood Beats - Multiplayer Version
 * Real-time collaborative phrase guessing game
 */

import {
  createRoom as firebaseCreateRoom,
  joinRoom as firebaseJoinRoom,
  listenRoom,
  writeGameState,
  startGame as firebaseStartGame,
  endGame as firebaseEndGame,
  deleteRoom,
  setupDisconnectHandler,
  removePlayer as firebaseRemovePlayer,
} from './firebase-sync.js';
import { initDeepLinkHandler, createShareHandler, showQRCode } from './deep-link-handler.js';

// ========== SPEECH PHRASES ==========
const SpeechPhrases = {
    encourage: [
        "Great!",
        "Excellent!",
        "Perfect!",
        "Brilliant!",
        "Superb!",
        "Outstanding!",
        "Fantastic!",
        "Amazing!",
        "Well done!",
        "Awesome!"
    ],
    disappoint: [
        "Oops! Try again",
        "Not this time",
        "Think again",
        "Oh no!",
        "Missed it!",
        "Better luck",
        "Almost there",
        "Keep trying",
        "Don't give up",
        "Next time"
    ],
    levelComplete: [
        "Level complete!",
        "You're on fire!",
        "Incredible!",
        "Amazing work!",
        "Keep going!",
        "You're a superstar!",
        "Excellent job!",
        "You rock!",
        "Brilliant play!",
        "Unstoppable!"
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
        if (isMuted()) return;
        if (!speechSynthesis) return;
        
        try {
            speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = 1.0;
            
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                const englishVoice = voices.find(v => v.lang.startsWith('en-'));
                if (englishVoice) {
                    utterance.voice = englishVoice;
                }
            }
            
            speechSynthesis.speak(utterance);
        } catch (err) {
            console.error('Speech synthesis error:', err);
        }
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

    function playRandomLevelComplete() {
        const phrases = SpeechPhrases.levelComplete;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 1.15, 1.3);
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
let isHost = false;
let unsubscribeRoom = null;
let timerInterval = null;

const SESSION_KEY = 'bollywood_beats_session';

let gameState = {
    gamePhrases: [],
    currentPhraseIndex: 0,
    currentPhrase: '',
    currentCategory: '',
    revealedLetters: new Set(),
    wrongGuesses: 0,
    maxWrongGuesses: 6,
    currentLevel: 1,
    maxLevels: 10,
    score: 0,
    timeRemaining: 1200,
    timerDuration: 1200,
    gameStartTime: null,
    lifelinesRemaining: 3,
    lifelinesUsed: [false, false, false],
    gameResult: null // 'won', 'lost', or null
};

// ========== SESSION PERSISTENCE ==========
function saveSession() {
    if (roomCode != null && playerIndex != null) {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerIndex, isHost }));
        } catch (_) {}
    }
}

function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
}

function loadSession() {
    try {
        const data = localStorage.getItem(SESSION_KEY);
        return data ? JSON.parse(data) : null;
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
    AudioManager.stopBackgroundMusic();
    clearSession();
    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }
    roomCode = null;
    playerIndex = null;
    isHost = false;
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
        isHost = true;
        
        saveSession();
        setupDisconnectHandler(roomCode, playerIndex);
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
    
    if (!code || code.length !== 4) {
        showToast('Please enter a valid 4-character room code', true);
        codeInput.focus();
        return;
    }
    
    try {
        showLoading('Joining room...');
        const result = await firebaseJoinRoom(code, name);
        roomCode = code;
        playerIndex = result.playerIndex;
        isHost = false;
        
        saveSession();
        setupDisconnectHandler(roomCode, playerIndex);
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
    if (unsubscribeRoom) {
        unsubscribeRoom();
    }
    
    unsubscribeRoom = listenRoom(roomCode, {
        onStatusChange: (status) => {
            console.log('[StatusChange] Status:', status);
            if (status === 'finished') {
                // Game ended - show appropriate screen based on game result
                // The gameState will have been updated with gameResult
                console.log('[StatusChange] Game finished, showing game over');
            }
        },
        onPlayersChange: (players) => {
            updatePlayersList(players);
        },
        onGameUpdate: (game, status) => {
            if (game) {
                updateGameFromFirebase(game);
                // Only show game screen if game is playing AND not ended
                if (status === 'playing' && !game.gameResult) {
                    const currentScreen = document.querySelector('.screen.active');
                    if (currentScreen && currentScreen.id !== 'gameScreen') {
                        showScreen('gameScreen');
                        hideLoading();
                        // Start timer and music when game screen is first shown
                        startTimer();
                        AudioManager.startBackgroundMusic(0.15);
                    }
                }
            }
        },
        onRoomDeleted: () => {
            console.log('[RoomDeleted] Room was deleted, returning to menu');
            showToast('Room closed by host', true);
            showMenu();
        }
    });
}

function updatePlayersList(players) {
    const list = document.getElementById('playersList');
    if (!list) return;
    
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
        
        // Load and shuffle phrases
        gameState.gamePhrases = await loadAndShufflePhrases();
        gameState.currentLevel = 1;
        gameState.currentPhraseIndex = 0;
        gameState.score = 0;
        gameState.timeRemaining = gameState.timerDuration;
        gameState.gameStartTime = Date.now();
        gameState.lifelinesRemaining = 3;
        gameState.lifelinesUsed = [false, false, false];
        
        // Initialize first level
        const phraseData = gameState.gamePhrases[0];
        gameState.currentPhrase = phraseData.text.toUpperCase();
        gameState.currentCategory = phraseData.category;
        gameState.revealedLetters = new Set();
        gameState.wrongGuesses = 0;
        
        // Add punctuation to revealed letters
        for (let char of gameState.currentPhrase) {
            if (!/[A-Z0-9]/.test(char)) {
                gameState.revealedLetters.add(char);
            }
        }
        
        // Convert Set to Array for Firebase
        const gameStateForFirebase = serializeGameState(gameState);
        
        // Start game in Firebase
        await firebaseStartGame(roomCode, gameStateForFirebase);
        
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Failed to start game:', error);
        showToast('Failed to start game. Please try again.', true);
    }
};

// ========== GAME STATE SYNC ==========
function serializeGameState(state) {
    return {
        ...state,
        gamePhrases: JSON.stringify(state.gamePhrases), // Convert array to JSON string
        revealedLetters: JSON.stringify(Array.from(state.revealedLetters)), // Convert to JSON string
        lifelinesUsed: JSON.stringify(state.lifelinesUsed), // Convert to JSON string
    };
}

function deserializeGameState(firebaseState) {
    return {
        ...firebaseState,
        gamePhrases: JSON.parse(firebaseState.gamePhrases || '[]'), // Parse JSON string back to array
        revealedLetters: new Set(JSON.parse(firebaseState.revealedLetters || '[]')), // Parse and convert to Set
        lifelinesUsed: JSON.parse(firebaseState.lifelinesUsed || '[false,false,false]'), // Parse JSON string back to array
    };
}

function updateGameFromFirebase(firebaseGameState) {
    if (!firebaseGameState) return;
    
    const previousResult = gameState.gameResult;
    const previousWrongGuesses = gameState.wrongGuesses;
    
    gameState = deserializeGameState(firebaseGameState);
    
    console.log('[UpdateFromFirebase] Wrong guesses:', previousWrongGuesses, '->', gameState.wrongGuesses, 'Result:', previousResult, '->', gameState.gameResult);
    
    updateGameUI();
    displayPhrase();
    createKeyboard();
    
    // Check win condition after receiving updates from other players
    checkWin();
    
    // Check lose condition after receiving updates from other players (host only)
    if (isHost && gameState.wrongGuesses >= gameState.maxWrongGuesses && !gameState.gameResult) {
        console.log('[UpdateFromFirebase] All lives exhausted, triggering game over');
        setTimeout(async () => {
            await gameLost();
        }, 1000);
    }
    
    // Check if game result was set (game ended)
    if (gameState.gameResult && gameState.gameResult !== previousResult) {
        console.log('[UpdateFromFirebase] Game result changed, showing game over. Result:', gameState.gameResult);
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
        if (bulbs[index]) {
            bulbs[index].className = 'lifeline-bulb' + (used ? '' : ' active');
            
            // Ensure click handler is attached (backup for onclick attribute)
            bulbs[index].onclick = function() {
                console.log('[Lifeline] Click handler triggered for bulb', index);
                window.useLifeline(index);
            };
        }
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
    // Clear any existing timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    // Start countdown on ALL devices (local countdown, no Firebase sync needed)
    timerInterval = setInterval(() => {
        gameState.timeRemaining--;
        updateTimerDisplay();
        
        // Check if time's up (only host ends the game)
        if (gameState.timeRemaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            if (isHost) {
                gameLost();
            }
        }
    }, 1000);
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
    
    const phrase = gameState.currentPhrase;
    const letterCount = phrase.replace(/[^A-Z0-9]/g, '').length;
    
    // Add dynamic sizing
    grid.classList.remove('short-phrase', 'medium-phrase', 'long-phrase', 'very-long-phrase');
    if (letterCount <= 15) {
        grid.classList.add('short-phrase');
    } else if (letterCount <= 25) {
        grid.classList.add('medium-phrase');
    } else if (letterCount <= 35) {
        grid.classList.add('long-phrase');
    } else {
        grid.classList.add('very-long-phrase');
    }
    
    const words = phrase.split(' ');
    
    words.forEach((word, wordIndex) => {
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word-container';
        
        for (let char of word) {
            const tile = document.createElement('div');
            tile.className = 'phrase-tile';
            
            if (/[A-Z0-9]/.test(char)) {
                tile.dataset.letter = char;
                if (gameState.revealedLetters.has(char)) {
                    tile.textContent = char;
                    tile.classList.add('revealed');
                }
            } else {
                tile.textContent = char;
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
    
    for (let key of allKeys) {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = key;
        btn.onclick = () => guessLetter(key, btn);
        
        // Disable if already guessed
        if (gameState.revealedLetters.has(key) || isLetterGuessed(key)) {
            btn.disabled = true;
            btn.classList.add(gameState.currentPhrase.includes(key) ? 'correct' : 'wrong');
        }
        
        keyboard.appendChild(btn);
    }
}

function isLetterGuessed(letter) {
    // Check if letter was guessed (either revealed or wrong)
    return gameState.revealedLetters.has(letter);
}

// ========== GAME LOGIC ==========
window.guessLetter = async function(letter, keyElement) {
    if (!roomCode || keyElement.disabled) return;
    
    keyElement.disabled = true;
    
    if (gameState.currentPhrase.includes(letter)) {
        // Correct guess
        gameState.revealedLetters.add(letter);
        keyElement.classList.add('correct');
        
        // Play correct sound and encouraging speech on ALL devices
        AudioManager.playSound('correct');
        setTimeout(() => AudioManager.playRandomEncourage(), 200);
        
        // Update Firebase
        await writeGameState(roomCode, serializeGameState(gameState));
        
        // Check win
        checkWin();
    } else {
        // Wrong guess
        gameState.wrongGuesses++;
        gameState.revealedLetters.add(letter); // Track as guessed
        keyElement.classList.add('wrong');
        
        // Play wrong sound and disappointing speech on ALL devices
        AudioManager.playSound('wrong');
        setTimeout(() => AudioManager.playRandomDisappoint(), 200);
        
        // Update Firebase
        await writeGameState(roomCode, serializeGameState(gameState));
        
        // Check lose
        checkLose();
    }
};

window.useLifeline = async function(index) {
    console.log('[Lifeline] Clicked lifeline', index, 'IsHost:', isHost, 'RoomCode:', roomCode, 'Already used:', gameState.lifelinesUsed[index]);
    
    if (!roomCode) {
        console.log('[Lifeline] No room code, cannot use lifeline');
        return;
    }
    
    if (gameState.lifelinesUsed[index]) {
        console.log('[Lifeline] This lifeline was already used');
        return;
    }
    
    console.log('[Lifeline] Using lifeline', index);
    
    // Mark lifeline as used
    gameState.lifelinesUsed[index] = true;
    gameState.lifelinesRemaining--;
    
    // Reveal a random unrevealed letter
    const unrevealedLetters = [];
    for (let char of gameState.currentPhrase) {
        if (/[A-Z0-9]/.test(char) && !gameState.revealedLetters.has(char)) {
            unrevealedLetters.push(char);
        }
    }
    
    if (unrevealedLetters.length > 0) {
        const randomLetter = unrevealedLetters[Math.floor(Math.random() * unrevealedLetters.length)];
        gameState.revealedLetters.add(randomLetter);
        console.log('[Lifeline] Revealed letter:', randomLetter);
        
        // Play sound and speech for lifeline on ALL devices
        AudioManager.playSound('correct');
        setTimeout(() => AudioManager.playRandomEncourage(), 200);
    } else {
        console.log('[Lifeline] No unrevealed letters to reveal');
    }
    
    // Update Firebase
    await writeGameState(roomCode, serializeGameState(gameState));
    console.log('[Lifeline] Updated Firebase');
    
    // Check win after using lifeline
    checkWin();
};

// Debug: Log that function is defined
console.log('[Init] useLifeline function defined:', typeof window.useLifeline);

function checkWin() {
    const requiredLetters = new Set(gameState.currentPhrase.match(/[A-Z0-9]/g));
    const allRevealed = [...requiredLetters].every(letter => gameState.revealedLetters.has(letter));
    
    console.log('[CheckWin] Required:', requiredLetters.size, 'Revealed:', gameState.revealedLetters.size, 'AllRevealed:', allRevealed, 'IsHost:', isHost);
    
    if (allRevealed) {
        // Level complete - play sound and speech on ALL devices
        AudioManager.playSound('win');
        setTimeout(() => AudioManager.playRandomLevelComplete(), 300);
        
        if (isHost) {
            const bonusPoints = (gameState.maxWrongGuesses - gameState.wrongGuesses) * 100;
            gameState.score += 500 + bonusPoints;
            
            console.log('[CheckWin] Level complete! Score:', gameState.score, 'Current Level:', gameState.currentLevel);
            
            setTimeout(async () => {
                if (gameState.currentLevel >= gameState.maxLevels) {
                    console.log('[CheckWin] All levels complete! Showing game won');
                    await gameWon();
                } else {
                    console.log('[CheckWin] Moving to next level');
                    await nextLevel();
                }
            }, 2000);
        } else {
            // Non-host just celebrates
            console.log('[CheckWin] Level complete! Waiting for host to advance...');
        }
    }
}

function checkLose() {
    if (gameState.wrongGuesses >= gameState.maxWrongGuesses && isHost) {
        setTimeout(async () => {
            await gameLost();
        }, 1000);
    }
}

async function nextLevel() {
    if (!isHost) return;
    
    console.log('[NextLevel] Moving to next level...');
    
    gameState.currentLevel++;
    gameState.currentPhraseIndex++;
    gameState.revealedLetters = new Set();
    gameState.wrongGuesses = 0;
    
    const phraseData = gameState.gamePhrases[gameState.currentPhraseIndex];
    gameState.currentPhrase = phraseData.text.toUpperCase();
    gameState.currentCategory = phraseData.category;
    
    console.log('[NextLevel] New level:', gameState.currentLevel, 'Phrase:', gameState.currentPhrase);
    
    // Add punctuation to revealed letters
    for (let char of gameState.currentPhrase) {
        if (!/[A-Z0-9]/.test(char)) {
            gameState.revealedLetters.add(char);
        }
    }
    
    // Write to Firebase
    await writeGameState(roomCode, serializeGameState(gameState));
    
    // Update local UI immediately for host
    updateGameUI();
    displayPhrase();
    createKeyboard();
}

async function gameWon() {
    console.log('[GameWon] All levels complete! IsHost:', isHost);
    
    AudioManager.stopBackgroundMusic();
    AudioManager.playSound('win');
    
    if (isHost) {
        // Host writes the final state and ends game
        gameState.gameResult = 'won'; // Store result for other players
        await writeGameState(roomCode, serializeGameState(gameState));
        await firebaseEndGame(roomCode);
    }
    
    // All players show game over screen
    showGameOver(true);
}

async function gameLost() {
    console.log('[GameLost] Out of lives! IsHost:', isHost);
    
    AudioManager.stopBackgroundMusic();
    
    if (isHost) {
        // Host writes the final state and ends game
        gameState.gameResult = 'lost'; // Store result for other players
        console.log('[GameLost] Host writing gameResult to Firebase:', gameState.gameResult);
        await writeGameState(roomCode, serializeGameState(gameState));
        await firebaseEndGame(roomCode);
        console.log('[GameLost] Firebase updated, showing game over');
    }
    
    // All players show game over screen
    showGameOver(false);
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
            <h1 class="gameover-title win">🎉 YOU WON! 🎉</h1>
            <div class="final-score">
                <div class="score-label">Final Score</div>
                <div class="score-value">${gameState.score}</div>
            </div>
            <button class="menu-btn primary" onclick="exitToMenu()">Back to Menu</button>
        `;
    } else {
        content.innerHTML = `
            <h1 class="gameover-title lose">😔 GAME OVER</h1>
            <div class="gameover-message">Better luck next time!</div>
            <div class="final-score">
                <div class="score-label">Final Score</div>
                <div class="score-value">${gameState.score}</div>
            </div>
            <button class="menu-btn primary" onclick="exitToMenu()">Back to Menu</button>
        `;
    }
    
    console.log('[ShowGameOver] Calling showScreen(gameOverScreen)');
    showScreen('gameOverScreen');
    console.log('[ShowGameOver] Screen switched');
}

window.exitToMenu = async function() {
    console.log('[ExitToMenu] Cleaning up and returning to menu. IsHost:', isHost, 'RoomCode:', roomCode);
    
    // Host deletes the room, others just leave
    if (isHost && roomCode) {
        try {
            await deleteRoom(roomCode);
            console.log('[ExitToMenu] Room deleted');
        } catch (error) {
            console.error('[ExitToMenu] Error deleting room:', error);
        }
    }
    
    showMenu();
};

window.quitGame = async function() {
    if (isHost) {
        await deleteRoom(roomCode);
    }
    showMenu();
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
        const allPhrases = [];
        
        for (let category of categories) {
            const categoryName = category.getAttribute('name');
            const phraseElements = category.getElementsByTagName('phrase');
            
            for (let phrase of phraseElements) {
                allPhrases.push({
                    text: phrase.textContent.trim(),
                    category: categoryName
                });
            }
        }
        
        if (allPhrases.length === 0) {
            throw new Error('No phrases found');
        }
        
        const shuffled = shuffleArray(allPhrases);
        return shuffled.slice(0, 10);
        
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
    // Set initial state
    muteBtn.textContent = AudioManager.isMuted() ? '🔇' : '🔊';
    
    muteBtn.addEventListener('click', () => {
        const muted = AudioManager.toggleMute();
        muteBtn.textContent = muted ? '🔇' : '🔊';
    });
}

console.log('Bollywood Beats Multiplayer loaded successfully!');


// ========== SESSION RESTORATION ==========
async function restoreSession() {
    const session = loadSession();
    if (!session) return false;
    
    try {
        // Import Firebase database functions
        const { db } = await import('./firebase-config.js');
        const { ref, get, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        
        // Check if room still exists
        const roomRef = ref(db, `bollywood-beats-rooms/${session.roomCode}`);
        const snapshot = await get(roomRef);
        
        if (!snapshot.exists()) {
            clearSession();
            return false;
        }
        
        const roomData = snapshot.val();
        const status = roomData.meta?.status;
        
        // Don't restore if game ended
        if (status === 'finished') {
            clearSession();
            return false;
        }
        
        // Restore session variables
        roomCode = session.roomCode;
        playerIndex = session.playerIndex;
        isHost = session.isHost;
        
        // Mark player as connected
        try {
            await update(ref(db, `bollywood-beats-rooms/${roomCode}/players/player_${playerIndex}`), {
                connected: true
            });
        } catch (_) {}
        
        // Setup disconnect handler
        setupDisconnectHandler(roomCode, playerIndex);
        
        // Restore to appropriate screen
        if (status === 'lobby') {
            startLobbyListener();
            showLobby();
            showToast('Reconnected to lobby');
            return true;
        }
        
        if (status === 'playing' && roomData.game) {
            startLobbyListener();
            gameState = deserializeGameState(roomData.game);
            updateGameUI();
            displayPhrase();
            createKeyboard();
            showScreen('gameScreen');
            startTimer();
            showToast('Reconnected to game');
            return true;
        }
        
        // Unknown state, clear session
        clearSession();
        return false;
        
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
