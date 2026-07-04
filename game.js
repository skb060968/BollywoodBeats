/**
 * Bollywood Wordly - Complete Game Logic
 * With MP3 Sound System and Correct Workflow
 */

// ========== GAME STATE ==========
let gameState = {
    gamePhrases: [], // 10 phrases selected for current game
    currentPhraseIndex: 0,
    currentPhrase: '',
    currentCategory: '',
    revealedLetters: new Set(),
    wrongGuesses: 0,
    maxWrongGuesses: 6,
    currentLevel: 1,
    maxLevels: 10,
    score: 0
};

// ========== CHARACTER MANAGER ==========
const CharacterManager = (() => {
    const ANIMATION_GIFS = {
        correct: './images/character-correct.gif',
        wrong: './images/character-wrong.gif',
        celebrate: './images/character-celebrate.gif'
    };
    
    let staticImg = null;
    let animatedImg = null;
    let svgFallback = null;
    let useImages = true;
    
    function init() {
        staticImg = document.getElementById('characterStatic');
        animatedImg = document.getElementById('characterAnimated');
        svgFallback = document.getElementById('characterAnimation');
        
        // Check if static image loads
        if (staticImg) {
            staticImg.onerror = function() {
                console.log('Character images not found, using SVG fallback');
                useImages = false;
                staticImg.style.display = 'none';
                if (svgFallback) {
                    svgFallback.style.display = 'block';
                }
            };
            
            staticImg.onload = function() {
                useImages = true;
                if (svgFallback) {
                    svgFallback.style.display = 'none';
                }
            };
        }
    }
    
    function playAnimation(type, duration) {
        if (!useImages) {
            // Use SVG fallback animations
            if (svgFallback) {
                svgFallback.className = `character ${type}`;
                setTimeout(() => {
                    svgFallback.className = 'character idle';
                }, duration);
            }
            return;
        }
        
        // Use GIF animations
        const gifUrl = ANIMATION_GIFS[type];
        if (!gifUrl || !animatedImg || !staticImg) return;
        
        // Hide static, show animated GIF
        staticImg.style.display = 'none';
        animatedImg.src = gifUrl + '?t=' + Date.now(); // Force reload GIF
        animatedImg.style.display = 'block';
        
        // After animation, switch back to static
        setTimeout(() => {
            animatedImg.style.display = 'none';
            animatedImg.src = ''; // Clear to save memory
            staticImg.style.display = 'block';
        }, duration);
    }
    
    function setIdle() {
        if (!useImages) {
            if (svgFallback) {
                svgFallback.className = 'character idle';
            }
            return;
        }
        
        if (staticImg && animatedImg) {
            animatedImg.style.display = 'none';
            animatedImg.src = '';
            staticImg.style.display = 'block';
        }
    }
    
    function setSad() {
        if (!useImages) {
            if (svgFallback) {
                svgFallback.classList.add('sad');
            }
            return;
        }
        
        if (staticImg) {
            staticImg.classList.add('sad');
        }
    }
    
    function removeSad() {
        if (!useImages) {
            if (svgFallback) {
                svgFallback.classList.remove('sad');
            }
            return;
        }
        
        if (staticImg) {
            staticImg.classList.remove('sad');
        }
    }
    
    return {
        init,
        playAnimation,
        setIdle,
        setSad,
        removeSad
    };
})();

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

    const MUTE_KEY = 'bollywood_wordly_muted';
    let backgroundMusic = null;
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
            // Cancel any ongoing speech
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

    function playSound(name, volume = 1.0) {
        if (isMuted()) return;
        
        const url = SOUND_FILES[name];
        if (!url) return;
        
        try {
            const audio = new Audio(url);
            audio.volume = volume;
            audio.play().catch(() => {});
        } catch (_) {}
    }

    function speak(text, rate = 1.0, pitch = 1.1) {
        if (isMuted()) return;
        if (!speechSynthesis) return;
        
        try {
            // Cancel any ongoing speech
            speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = rate; // Speed of speech (0.1 to 10)
            utterance.pitch = pitch; // Pitch (0 to 2)
            utterance.volume = 1.0; // Volume (0 to 1) - Set to 100% maximum
            
            // Try to use a voice (optional - will use default if not found)
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                // Prefer English voices for better pronunciation
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
        speak(phrase, 1.1, 1.2); // Faster and higher pitch for excitement
    }

    function playRandomDisappoint() {
        const phrases = SpeechPhrases.disappoint;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 0.95, 0.9); // Slower and lower pitch for disappointment
    }

    function playRandomLevelComplete() {
        const phrases = SpeechPhrases.levelComplete;
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        speak(phrase, 1.15, 1.3); // Very excited voice
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
        
        // Stop any ongoing speech
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

    return {
        playSound,
        playRandomEncourage,
        playRandomDisappoint,
        playRandomLevelComplete,
        toggleMute,
        isMuted,
        startBackgroundMusic,
        stopBackgroundMusic,
    };
})();

// ========== SCREEN NAVIGATION ==========
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showMenu() {
    AudioManager.stopBackgroundMusic();
    showScreen('menuScreen');
}

function showInstructions() {
    showScreen('instructionsScreen');
}

function showSettings() {
    // Pause game but don't stop music
    showScreen('settingsScreen');
    // Initialize preset file buttons
    initializePresetFiles();
    // Don't load XML info automatically - only show after user action
}

function quitGame() {
    if (confirm('Are you sure you want to quit the current game?')) {
        AudioManager.stopBackgroundMusic();
        showMenu();
    }
}

// ========== PHRASE LOADER ==========
function shuffleArray(array) {
    // Fisher-Yates shuffle algorithm (more robust)
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function loadAndShufflePhrases() {
    try {
        let text;
        
        // Use custom content if available, otherwise fetch the file
        if (currentXMLContent) {
            text = currentXMLContent;
            console.log(`📂 Using custom XML content from: ${currentXMLFileName}`);
        } else {
            const response = await fetch(currentXMLFileName);
            
            if (!response.ok) {
                throw new Error(`Failed to load XML file: ${response.status} ${response.statusText}`);
            }
            
            text = await response.text();
            console.log(`📂 Loaded XML from file: ${currentXMLFileName}`);
        }
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        // Check for XML parsing errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('XML file is corrupted or invalid');
        }
        
        const categories = xmlDoc.getElementsByTagName('category');
        const allPhrases = [];
        
        // Collect all phrases with their categories
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
            throw new Error('No phrases found in XML file');
        }
        
        console.log(`✅ SUCCESS: ${allPhrases.length} phrases loaded from ${currentXMLFileName}`);
        
        // Shuffle all phrases once (Fisher-Yates is proven random)
        const shuffled = shuffleArray(allPhrases);
        
        // Select first 10 phrases for the game
        const selected = shuffled.slice(0, 10);
        
        console.log('📋 Selected phrases for this game:');
        selected.forEach((p, i) => console.log(`  ${i+1}. ${p.text} (${p.category})`));
        
        return selected;
        
    } catch (error) {
        console.error(`❌ ERROR: Could not load ${currentXMLFileName}:`, error.message);
        console.warn('⚠️ Using FALLBACK phrases (only 10 hardcoded phrases)');
        
        // Fallback phrases with categories
        const fallback = [
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
        return shuffleArray(fallback);
    }
}

// ========== LOADING UI ==========
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

// ========== GAME START ==========
async function startGame() {
    showLoading('Loading phrases...');
    
    try {
        // Load and shuffle all phrases, then select 10 for this game
        gameState.gamePhrases = await loadAndShufflePhrases();
        gameState.currentLevel = 1;
        gameState.currentPhraseIndex = 0;
        gameState.score = 0;
        
        hideLoading();
        startLevel();
        showScreen('gameScreen');
        AudioManager.startBackgroundMusic(0.15);
        
    } catch (error) {
        console.error('Failed to start game:', error);
        hideLoading();
        alert('Failed to load game. Please try again.');
    }
}

function startLevel() {
    gameState.revealedLetters = new Set();
    gameState.wrongGuesses = 0;
    
    // Get the current phrase from the 10 selected phrases
    const phraseData = gameState.gamePhrases[gameState.currentPhraseIndex];
    gameState.currentPhrase = phraseData.text.toUpperCase();
    gameState.currentCategory = phraseData.category;
    
    updateGameUI();
    createKeyboard();
    displayPhrase();
}

// ========== UI UPDATES ==========
function updateGameUI() {
    // Update score
    document.getElementById('scoreDisplay').textContent = gameState.score;
    
    // Update level dots
    const levelsDots = document.getElementById('levelsDots');
    levelsDots.innerHTML = '';
    for (let i = 0; i < gameState.maxLevels; i++) {
        const dot = document.createElement('div');
        dot.className = 'level-dot';
        if (i < gameState.currentLevel - 1) {
            dot.classList.add('completed');
        }
        levelsDots.appendChild(dot);
    }
    
    // Update lives (X marks)
    const livesPanel = document.getElementById('livesPanel');
    livesPanel.innerHTML = '';
    const wrongGuesses = gameState.wrongGuesses;
    for (let i = 0; i < gameState.maxWrongGuesses; i++) {
        const lifeBox = document.createElement('div');
        lifeBox.className = 'life-box';
        if (i < wrongGuesses) {
            lifeBox.textContent = 'X';
            lifeBox.classList.add('lost');
        }
        livesPanel.appendChild(lifeBox);
    }
    
    // Reset character to idle
    CharacterManager.setIdle();
    CharacterManager.removeSad();
}

function displayPhrase() {
    const grid = document.getElementById('phraseGrid');
    grid.innerHTML = '';
    
    const phrase = gameState.currentPhrase;
    
    // Calculate phrase length (excluding spaces and punctuation) for dynamic sizing
    const letterCount = phrase.replace(/[^A-Z0-9]/g, '').length;
    
    // Add dynamic sizing class based on phrase length
    grid.classList.remove('short-phrase', 'medium-phrase', 'long-phrase', 'very-long-phrase');
    if (letterCount <= 15) {
        grid.classList.add('short-phrase'); // Big tiles for short phrases
    } else if (letterCount <= 25) {
        grid.classList.add('medium-phrase'); // Medium tiles
    } else if (letterCount <= 35) {
        grid.classList.add('long-phrase'); // Smaller tiles
    } else {
        grid.classList.add('very-long-phrase'); // Very small tiles for long phrases
    }
    
    // Split phrase into words to prevent breaking words across lines
    const words = phrase.split(' ');
    
    words.forEach((word, wordIndex) => {
        // Create a word container to keep letters together
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word-container';
        
        // Add each letter of the word
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
                // Punctuation marks
                tile.textContent = char;
                tile.classList.add('punctuation');
                gameState.revealedLetters.add(char);
            }
            
            wordContainer.appendChild(tile);
        }
        
        grid.appendChild(wordContainer);
        
        // Add space between words (except after last word)
        if (wordIndex < words.length - 1) {
            const spaceTile = document.createElement('div');
            spaceTile.className = 'phrase-tile space';
            grid.appendChild(spaceTile);
        }
    });
}

function createKeyboard() {
    // Letters A-Z + Numbers 1-4 in 10×3 grid (30 keys total)
    const allKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'; // 26 letters + 4 numbers = 30
    
    const keyboardCombined = document.getElementById('keyboardCombined');
    
    if (!keyboardCombined) {
        console.error('keyboardCombined element not found');
        return;
    }
    
    keyboardCombined.innerHTML = '';
    
    // Create all 30 buttons in 10×3 grid
    for (let key of allKeys) {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = key;
        btn.onclick = () => guessLetter(key, btn);
        keyboardCombined.appendChild(btn);
    }
    
    // Display the actual category of current phrase
    document.getElementById('categoryText').textContent = gameState.currentCategory;
}

// ========== GAME LOGIC ==========
function guessLetter(letter, keyElement) {
    if (keyElement.disabled) return;
    
    keyElement.disabled = true;
    
    if (gameState.currentPhrase.includes(letter)) {
        gameState.revealedLetters.add(letter);
        keyElement.classList.add('correct');
        
        // Play correct sound and encouraging voice phrase
        AudioManager.playSound('correct');
        setTimeout(() => AudioManager.playRandomEncourage(), 200);
        
        // Play correct animation
        CharacterManager.playAnimation('correct', 800);
        
        const grid = document.getElementById('phraseGrid');
        const tiles = grid.querySelectorAll('.phrase-tile');
        tiles.forEach(tile => {
            if (tile.dataset.letter === letter) {
                tile.textContent = letter;
                tile.classList.add('revealed');
            }
        });
        
        checkWin();
    } else {
        gameState.wrongGuesses++;
        keyElement.classList.add('wrong');
        
        // Play wrong sound and disappointing voice phrase
        AudioManager.playSound('wrong');
        setTimeout(() => AudioManager.playRandomDisappoint(), 200);
        
        // Play wrong animation
        CharacterManager.playAnimation('wrong', 800);
        
        // Set sad state if all lives lost
        setTimeout(() => {
            if (gameState.wrongGuesses >= gameState.maxWrongGuesses) {
                CharacterManager.setSad();
            }
        }, 800);
        
        updateGameUI();
        checkLose();
    }
}

function checkWin() {
    const requiredLetters = new Set(gameState.currentPhrase.match(/[A-Z0-9]/g));
    const allRevealed = [...requiredLetters].every(letter => gameState.revealedLetters.has(letter));
    
    if (allRevealed) {
        const bonusPoints = (gameState.maxWrongGuesses - gameState.wrongGuesses) * 100;
        gameState.score += 500 + bonusPoints;
        
        // Play celebrate animation
        CharacterManager.playAnimation('celebrate', 2000);
        
        // Play win sound and level complete voice phrase
        AudioManager.playSound('win');
        setTimeout(() => AudioManager.playRandomLevelComplete(), 300);
        
        setTimeout(() => {
            if (gameState.currentLevel >= gameState.maxLevels) {
                gameWon();
            } else {
                gameState.currentLevel++;
                gameState.currentPhraseIndex++;
                startLevel();
            }
        }, 2000);
    }
}

function checkLose() {
    if (gameState.wrongGuesses >= gameState.maxWrongGuesses) {
        setTimeout(() => {
            gameLost();
        }, 1000);
    }
}

function gameWon() {
    AudioManager.stopBackgroundMusic();
    AudioManager.playSound('win');
    
    const gameOverContent = document.getElementById('gameOverContent');
    gameOverContent.innerHTML = `
        <h2 class="win">🎉 Congratulations! 🎉</h2>
        <p style="font-size: 0.9rem; margin: 6px 0; color: #333;">You completed all ${gameState.maxLevels} levels!</p>
        <div class="final-score">Final Score: <span style="color: #FFD700;">${gameState.score}</span></div>
        <div class="gameover-buttons">
            <button class="gameover-btn primary" onclick="startGame()">
                <span>🎮</span> Play Again
            </button>
            <button class="gameover-btn" onclick="showMenu()">
                <span>🏠</span> Main Menu
            </button>
        </div>
    `;
    
    showScreen('gameOverScreen');
}

function gameLost() {
    AudioManager.stopBackgroundMusic();
    
    const gameOverContent = document.getElementById('gameOverContent');
    gameOverContent.innerHTML = `
        <h2 class="lose">😢 Game Over</h2>
        <p style="font-size: 0.8rem; margin: 6px 0; color: #333;">The phrase was:</p>
        <div class="revealed-phrase">${gameState.currentPhrase}</div>
        <p style="font-size: 0.75rem; margin: 6px 0; color: #666;">You reached level ${gameState.currentLevel}</p>
        <div class="final-score">Final Score: <span style="color: #FFD700;">${gameState.score}</span></div>
        <div class="gameover-buttons">
            <button class="gameover-btn primary" onclick="startGame()">
                <span>🔄</span> Try Again
            </button>
            <button class="gameover-btn" onclick="showMenu()">
                <span>🏠</span> Main Menu
            </button>
        </div>
    `;
    
    showScreen('gameOverScreen');
}

function quitGame() {
    if (confirm('Are you sure you want to quit the current game?')) {
        AudioManager.stopBackgroundMusic();
        showMenu();
    }
}

// ========== INITIALIZATION ==========
window.addEventListener('DOMContentLoaded', () => {
    showMenu();
    
    // Initialize character manager
    CharacterManager.init();
    
    // Setup mute button
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        // Set initial state
        muteBtn.textContent = AudioManager.isMuted() ? '🔇' : '🔊';
        
        muteBtn.addEventListener('click', () => {
            const muted = AudioManager.toggleMute();
            muteBtn.textContent = muted ? '🔇' : '🔊';
        });
    }
});


// ========== XML MANAGEMENT FUNCTIONS ==========
let currentXMLContent = null;
let currentXMLFileName = 'Bollywood.xml.txt';

// Define available preset files
const PRESET_FILES = [
    { name: 'Bollywood.xml.txt', label: '🎭 Actors & Stars', description: 'Heroes, Heroines & South Stars' },
    { name: 'Movies.xml.txt', label: '🎬 Bollywood Movies', description: 'Classic & Modern Films' },
    { name: 'Singers.xml.txt', label: '🎤 Playback Singers', description: 'Legendary & Current Singers' },
];

// Initialize preset file buttons
function initializePresetFiles() {
    const container = document.getElementById('presetFileButtons');
    if (!container) return;
    
    container.innerHTML = '';
    
    PRESET_FILES.forEach(file => {
        const button = document.createElement('button');
        button.className = 'setting-btn preset-file-btn';
        button.onclick = () => loadPresetFile(file.name);
        
        // Add active class if this is the current file
        if (file.name === currentXMLFileName && !currentXMLContent) {
            button.classList.add('active-preset');
        }
        
        button.innerHTML = `${file.label}`;
        button.title = file.description; // Show description as tooltip
        
        container.appendChild(button);
    });
}

// Load a preset file
async function loadPresetFile(fileName) {
    showLoading(`Loading ${fileName}...`);
    
    try {
        const response = await fetch(fileName);
        if (!response.ok) {
            throw new Error(`File not found: ${fileName}`);
        }
        
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        // Validate
        const parseError = xmlDoc.querySelector('parseerror');
        if (parseError) {
            hideLoading();
            alert(`❌ Error loading preset file!\n\n${fileName} has XML syntax errors.`);
            return;
        }
        
        // Success - reset to use this preset file
        currentXMLFileName = fileName;
        currentXMLContent = null; // Clear custom content to use the file directly
        
        // Reload phrases from the new file
        await loadAndShufflePhrases();
        
        hideLoading();
        alert(`✅ Loaded successfully!\n\nFile: ${fileName}\n\nStart a new game to play with these phrases.`);
        
        // Update UI
        initializePresetFiles();
        checkXMLInfo();
        
    } catch (error) {
        hideLoading();
        alert(`❌ Error loading preset file!\n\n${fileName}\n\nError: ${error.message}`);
    }
}

async function checkXMLInfo() {
    // Show the file info section
    const fileInfoSection = document.getElementById('fileInfoSection');
    if (fileInfoSection) {
        fileInfoSection.style.display = 'block';
    }
    
    try {
        const response = await fetch(currentXMLFileName);
        
        // Check if fetch was successful
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        
        // Check for XML parsing errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            document.getElementById('xmlStatus').textContent = '❌ Invalid XML';
            document.getElementById('xmlStatus').style.color = '#D32F2F';
            document.getElementById('totalPhrases').textContent = '-';
            document.getElementById('totalCategories').textContent = '-';
            document.getElementById('currentFile').textContent = currentXMLFileName;
            return;
        }
        
        const categories = xmlDoc.getElementsByTagName('category');
        let totalPhrases = 0;
        
        for (let category of categories) {
            const phraseElements = category.getElementsByTagName('phrase');
            totalPhrases += phraseElements.length;
        }
        
        document.getElementById('currentFile').textContent = currentXMLFileName;
        document.getElementById('xmlStatus').textContent = '✅ Valid';
        document.getElementById('xmlStatus').style.color = '#4CAF50';
        document.getElementById('totalPhrases').textContent = totalPhrases;
        document.getElementById('totalCategories').textContent = categories.length;
        
    } catch (error) {
        console.error('Error checking XML info:', error);
        document.getElementById('currentFile').textContent = currentXMLFileName;
        document.getElementById('xmlStatus').textContent = '❌ File not found';
        document.getElementById('xmlStatus').style.color = '#D32F2F';
        document.getElementById('totalPhrases').textContent = '-';
        document.getElementById('totalCategories').textContent = '-';
    }
}

async function validateXMLFile() {
    const fileInput = document.getElementById('validateXMLInput');
    
    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        showLoading('Validating XML file...');
        
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            
            // Check for XML parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                hideLoading();
                alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nThe XML file has syntax errors. Please check the file format.`);
                fileInput.value = '';
                return;
            }
            
            // Validate structure
            const categories = xmlDoc.getElementsByTagName('category');
            if (categories.length === 0) {
                hideLoading();
                alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nNo categories found in the XML file.`);
                fileInput.value = '';
                return;
            }
            
            let totalPhrases = 0;
            const categoryNames = [];
            const categoryDetails = [];
            const allPhrases = new Set(); // Track all phrases to detect duplicates
            const duplicates = [];
            
            for (let category of categories) {
                const categoryName = category.getAttribute('name');
                if (!categoryName) {
                    hideLoading();
                    alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nFound a category without a name attribute.`);
                    fileInput.value = '';
                    return;
                }
                
                categoryNames.push(categoryName);
                const phraseElements = category.getElementsByTagName('phrase');
                
                if (phraseElements.length === 0) {
                    hideLoading();
                    alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nCategory "${categoryName}" has no phrases.`);
                    fileInput.value = '';
                    return;
                }
                
                // Check for duplicate phrases
                for (let phraseElement of phraseElements) {
                    const phraseText = phraseElement.textContent.trim().toUpperCase();
                    if (allPhrases.has(phraseText)) {
                        duplicates.push(`"${phraseElement.textContent.trim()}" in category "${categoryName}"`);
                    } else {
                        allPhrases.add(phraseText);
                    }
                }
                
                categoryDetails.push(`  • ${categoryName}: ${phraseElements.length} phrases`);
                totalPhrases += phraseElements.length;
            }
            
            // Check minimum phrase requirement
            if (totalPhrases < 10) {
                hideLoading();
                alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nThe file must have at least 10 phrases for the 10 game levels.\n\nCurrent phrases: ${totalPhrases}`);
                fileInput.value = '';
                return;
            }
            
            hideLoading();
            
            // Success message with details
            let message = `✅ XML Validation Successful!\n\n` +
                         `File: ${file.name}\n` +
                         `Categories: ${categories.length}\n` +
                         `Total Phrases: ${totalPhrases}\n\n` +
                         `Details:\n${categoryDetails.join('\n')}\n\n`;
            
            // Add duplicate warning if any found
            if (duplicates.length > 0) {
                message += `⚠️ Warning: ${duplicates.length} duplicate phrase(s) found:\n${duplicates.slice(0, 5).join('\n')}`;
                if (duplicates.length > 5) {
                    message += `\n...and ${duplicates.length - 5} more duplicates`;
                }
                message += '\n\nDuplicates won\'t cause errors but may repeat in gameplay.\n\n';
            }
            
            message += `This file is ready to be loaded!`;
            
            alert(message);
            
        } catch (error) {
            hideLoading();
            alert(`❌ XML Validation Failed!\n\nFile: ${file.name}\n\nCould not read the file. Error: ${error.message}`);
        }
        
        // Reset file input
        fileInput.value = '';
    };
    
    // Trigger file selection
    fileInput.click();
}

function loadCustomXML() {
    const fileInput = document.getElementById('customXMLInput');
    
    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        showLoading('Loading custom XML...');
        
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            
            // Validate
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                hideLoading();
                alert('❌ Invalid XML file!\n\nThe selected file has XML syntax errors.');
                return;
            }
            
            const categories = xmlDoc.getElementsByTagName('category');
            if (categories.length === 0) {
                hideLoading();
                alert('❌ Invalid XML file!\n\nNo categories found in the file.');
                return;
            }
            
            // Count total phrases and check minimum requirement
            let totalPhrases = 0;
            for (let category of categories) {
                const phraseElements = category.getElementsByTagName('phrase');
                totalPhrases += phraseElements.length;
            }
            
            if (totalPhrases < 10) {
                hideLoading();
                alert(`❌ Invalid XML file!\n\nThe file must have at least 10 phrases for the 10 game levels.\n\nCurrent phrases: ${totalPhrases}`);
                return;
            }
            
            // Store the content and filename
            currentXMLContent = text;
            currentXMLFileName = file.name;
            
            // Create a temporary blob URL for the loaded file
            const blob = new Blob([text], { type: 'text/xml' });
            const url = URL.createObjectURL(blob);
            
            // Override fetch for this file
            const originalFetch = window.fetch;
            window.fetch = function(resource, options) {
                if (resource === currentXMLFileName) {
                    return Promise.resolve(new Response(text));
                }
                return originalFetch(resource, options);
            };
            
            // Reload phrases from the new file
            await loadAndShufflePhrases();
            
            hideLoading();
            alert(`✅ Custom XML loaded successfully!\n\nFile: ${file.name}\n\nStart a new game to play with these phrases.`);
            
            // Update info display
            checkXMLInfo();
            
        } catch (error) {
            hideLoading();
            alert('❌ Error loading file!\n\nCould not read the selected file.');
        }
        
        // Reset file input
        fileInput.value = '';
    };
    
    // Trigger file selection
    fileInput.click();
}

async function resetToDefaultXML() {
    if (!confirm('Reset to default phrase file?\n\nThis will use the original Bollywood.xml.txt file.')) {
        return;
    }
    
    showLoading('Resetting to default...');
    
    // Reset to default
    currentXMLFileName = 'Bollywood.xml.txt';
    currentXMLContent = null;
    
    // Restore original fetch if it was overridden
    if (window.fetch.toString().includes('currentXMLFileName')) {
        location.reload(); // Simplest way to restore original fetch
        return;
    }
    
    // Reload phrases from default file
    await loadAndShufflePhrases();
    
    hideLoading();
    alert('✅ Reset to default!\n\nStart a new game to play with Bollywood.xml.txt');
    
    // Update UI
    initializePresetFiles();
    checkXMLInfo();
}
