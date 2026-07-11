# Testing Bollywood Beats Multiplayer

## Quick Start

### Option 1: Deploy to Vercel (Easiest)
1. Push the `multiplayer-feature` branch (already done ✅)
2. Deploy on Vercel from this branch
3. Open the deployed URL + `/multiplayer.html`
4. Open in multiple devices/tabs to test multiplayer

### Option 2: Local Testing
1. Open two browser windows
2. Window 1: Navigate to `multiplayer.html` (create room)
3. Window 2: Navigate to `multiplayer.html` (join room with code)

## Testing Steps

### Test 1: Room Creation & Joining
1. **Device 1**: Open `multiplayer.html`
2. Click "Create Room"
3. Enter name: "Player 1"
4. Note the 4-character room code (e.g., "ABCD")
5. **Device 2**: Open `multiplayer.html`
6. Click "Join Room"
7. Enter name: "Player 2"
8. Enter room code from step 4
9. ✅ Both devices should show lobby with 2 players

### Test 2: Start Game
1. **Device 1 (Host)**: Click "Start Game"
2. ✅ Both devices should show game screen with same phrase

### Test 3: Collaborative Guessing
1. **Device 1**: Click letter "A" (if in phrase)
2. ✅ Both devices should show "A" revealed
3. **Device 2**: Click letter "B" (not in phrase)
4. ✅ Both devices should show lives decrease

### Test 4: Lifelines
1. **Device 1 (Host)**: Click lifeline bulb 💡
2. ✅ Both devices should show random letter revealed
3. ✅ Lifeline bulb should turn off on both devices

### Test 5: Win/Lose
1. Complete the phrase correctly
2. ✅ Both devices advance to next level
3. Lose all 6 lives
4. ✅ Both devices show game over

## Current Status

✅ **COMPLETED**:
- Firebase integration
- Room creation/joining
- Lobby system
- Real-time letter guessing sync
- Shared lives and lifelines
- Level progression
- Win/lose conditions
- Disconnect handling

⚠️ **NOTES**:
- Timer runs independently on each device (not synced)
- Only host can use lifelines
- No timer adjustment during game
- No in-game chat

## Deployment URLs

Once deployed, you can access:
- Single Player: `https://your-domain.vercel.app/index.html`
- Multiplayer: `https://your-domain.vercel.app/multiplayer.html`

## Reverting if Needed

If you want to go back to single-player only:

```bash
git checkout main
```

The multiplayer feature is safely isolated in the `multiplayer-feature` branch.
