# Firebase Rules Setup for BollywoodBeats Multiplayer

## Overview
BollywoodBeats multiplayer uses the same Firebase project as your other games (Card Games, Tambola, Roulette, etc.). You need to **add new rules** for `bollywood-beats-rooms` to the existing Firebase Realtime Database rules.

## Important: DON'T Replace Existing Rules!

❌ **DO NOT** replace the entire Firebase rules file  
✅ **DO** add the BollywoodBeats rules to your existing rules

## Step-by-Step Setup

### Option 1: Firebase Console (Recommended)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select project: **snakes-and-ladders3d**
3. Navigate to: **Realtime Database** → **Rules** tab
4. You'll see existing rules for:
   - `rooms` (Snakes and Ladders)
   - `tambola-rooms`
   - `ppp-rooms`
   - `card-games`
   - `snl-rooms`
   - `tambola-mp-rooms`
   - `roulette-rooms`

5. **Add** the following section to the existing rules (inside the main `"rules"` object):

```json
"bollywood-beats-rooms": {
  "$roomCode": {
    ".read": "auth != null",
    ".write": "auth != null",
    ".validate": "newData.hasChildren(['meta', 'players'])",
    "meta": {
      ".validate": "newData.hasChildren(['hostUid', 'hostName', 'status', 'createdAt', 'lastActivity'])",
      "hostUid": { 
        ".validate": "newData.isString()" 
      },
      "hostName": { 
        ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 15" 
      },
      "status": { 
        ".validate": "newData.isString() && (newData.val() === 'lobby' || newData.val() === 'playing' || newData.val() === 'finished')" 
      },
      "createdAt": { 
        ".validate": "newData.isNumber() && newData.val() > 0" 
      },
      "lastActivity": { 
        ".validate": "newData.isNumber() && newData.val() > 0" 
      }
    },
    "players": {
      "$playerId": {
        ".validate": "newData.hasChildren(['name', 'uid', 'connected'])",
        "name": { 
          ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 15" 
        },
        "uid": { 
          ".validate": "newData.isString()" 
        },
        "connected": { 
          ".validate": "newData.isBoolean()" 
        }
      }
    },
    "game": {
      "gamePhrases": {
        ".validate": "newData.isString() || !newData.exists()"
      },
      "currentPhraseIndex": { 
        ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 9" 
      },
      "currentPhrase": { 
        ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 100" 
      },
      "currentCategory": { 
        ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 50" 
      },
      "revealedLetters": {
        ".validate": "newData.isString() || !newData.exists()"
      },
      "wrongGuesses": { 
        ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 6" 
      },
      "maxWrongGuesses": { 
        ".validate": "newData.isNumber() && newData.val() === 6" 
      },
      "currentLevel": { 
        ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 10" 
      },
      "maxLevels": { 
        ".validate": "newData.isNumber() && newData.val() === 10" 
      },
      "score": { 
        ".validate": "newData.isNumber() && newData.val() >= 0" 
      },
      "timeRemaining": { 
        ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 3600" 
      },
      "timerDuration": { 
        ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 3600" 
      },
      "gameStartTime": { 
        ".validate": "newData.isNumber() || newData.val() === null" 
      },
      "lifelinesRemaining": { 
        ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 3" 
      },
      "lifelinesUsed": {
        ".validate": "newData.isString() || !newData.exists()"
      }
    }
  }
}
```

6. Click **Publish** to save the rules
7. Test that you can create/join rooms in BollywoodBeats

### Option 2: Firebase CLI (Alternative)

If you're using Firebase CLI to manage rules:

1. Find your `firebase-rules.json` or `database.rules.json` file
2. Add the `bollywood-beats-rooms` section to the existing rules
3. Deploy using:
   ```bash
   firebase deploy --only database
   ```

## Rules Explanation

### Room Structure
```
bollywood-beats-rooms/
  {roomCode}/           # e.g., "ABCD"
    meta/               # Room metadata
      hostUid           # Host's Firebase UID
      hostName          # Host's display name (1-15 chars)
      status            # "lobby" | "playing" | "finished"
      createdAt         # Timestamp (ms)
      lastActivity      # Timestamp (ms)
    
    players/            # All players in room
      player_0/         # Host
        name            # Player name (1-15 chars)
        uid             # Firebase UID
        connected       # Boolean (online/offline)
      player_1/         # Additional players
        ...
    
    game/               # Game state (only exists during play)
      currentPhrase     # Current phrase to guess
      currentCategory   # Category name
      revealedLetters   # Array of guessed letters
      wrongGuesses      # Count (0-6)
      currentLevel      # Level number (1-10)
      score             # Total score
      lifelinesUsed     # Array of booleans
      ...
```

### Security Features

✅ **Authentication Required**: Only authenticated users can read/write  
✅ **Name Length**: 1-15 characters (prevents abuse)  
✅ **Status Validation**: Only valid statuses allowed  
✅ **Lives Cap**: Maximum 6 wrong guesses  
✅ **Levels Cap**: Maximum 10 levels  
✅ **Timer Limit**: Maximum 1 hour (3600 seconds)  
✅ **Lifelines**: Maximum 3 lifelines  

### What These Rules Protect Against

1. **Invalid Data**: Schema validation ensures correct structure
2. **Malicious Values**: Numeric limits prevent extreme values
3. **Unauthorized Access**: Anonymous users cannot access rooms
4. **Data Corruption**: Required fields prevent incomplete data

## Testing the Rules

After deploying, test in this order:

1. **Create Room** - Should work
2. **Join Room** - Should work
3. **Start Game** - Should work
4. **Guess Letter** - Should update game state
5. **Use Lifeline** - Should update lifelinesUsed
6. **Complete Level** - Should advance to next level

If any operation fails, check the Firebase Console logs for rule violations.

## Troubleshooting

### Error: Permission Denied
- **Cause**: Rules not deployed or user not authenticated
- **Fix**: Check Firebase Console → Rules, ensure published

### Error: Validation Failed
- **Cause**: Data doesn't match expected structure
- **Fix**: Check that your code sends data matching the schema

### Error: Data Too Long
- **Cause**: Name/phrase exceeds maximum length
- **Fix**: Reduce player name to ≤15 chars, phrases to ≤100 chars

## Database Usage Estimates

**Free Tier Limits:**
- Simultaneous connections: 100
- Storage: 1 GB
- Downloads: 10 GB/month

**BollywoodBeats Usage:**
- Per room: ~5 KB
- Per game: ~30 writes, ~20 reads
- 100 concurrent games = ~500 KB
- Should easily stay within free tier limits

## Cleanup (Optional)

Old/inactive rooms can accumulate. To clean up:

1. Go to Firebase Console → Realtime Database
2. Navigate to `bollywood-beats-rooms`
3. Delete rooms with old `lastActivity` timestamps
4. Or implement auto-cleanup in your code (delete after 24 hours)

## Summary

✅ Add `bollywood-beats-rooms` rules to Firebase Console  
✅ Publish the rules  
✅ Test room creation/joining  
✅ Monitor Firebase usage in Console  

Your multiplayer game will now have proper security and validation!
