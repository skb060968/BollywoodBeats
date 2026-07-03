# 🎬 Bollywood Beats PWA 🎵

Progressive Web App version of Bollywood Beats - Play instantly in your browser!

## 🌟 Features

- ✅ **No Installation Required** - Play directly in browser
- ✅ **Offline Support** - Play even without internet
- ✅ **Cross-Platform** - Works on Windows, Mac, Android, iOS, Linux
- ✅ **Installable** - Add to home screen like a native app
- ✅ **Mobile Friendly** - Responsive design for all devices
- ✅ **3 Game Modes** - Actors, Movies, Singers
- ✅ **Custom XML Support** - Load your own phrase files

## 🎮 Game Modes

1. **🎭 Actors & Stars** - 160+ Bollywood heroes, heroines & South stars
2. **🎬 Bollywood Movies** - 59 classic & modern films
3. **🎤 Playback Singers** - 39 legendary & current singers

## 🚀 Deployment to Vercel

### One-Click Deploy:
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/bollywood-beats-pwa)

### Manual Deployment:

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   cd BollywoodBeatsPWA
   vercel
   ```

3. **For Production:**
   ```bash
   vercel --prod
   ```

## 📱 PWA Installation

### On Desktop (Chrome/Edge):
1. Visit the deployed URL
2. Look for install icon in address bar
3. Click "Install" or "Add to..."
4. App appears as standalone window

### On Mobile:
1. Visit the URL in browser
2. Tap Share/Menu button
3. Select "Add to Home Screen"
4. Icon appears on home screen

## 📂 Project Structure

```
BollywoodBeatsPWA/
├── images/              # Character animations
├── sounds/              # Sound effects
├── index.html           # Main HTML file
├── game.js              # Game logic
├── styles.css           # Styling
├── manifest.json        # PWA manifest
├── sw.js                # Service worker
├── vercel.json          # Deployment config
├── Bollywood.xml.txt    # Actors phrases
├── Movies.xml.txt       # Movies phrases
├── Singers.xml.txt      # Singers phrases
├── icon-192.png         # PWA icon (192x192)
├── icon-512.png         # PWA icon (512x512)
└── README.md            # This file
```

## 🎨 Missing Icons

You need to add PWA icons before deployment:
- **icon-192.png** - 192×192px app icon
- **icon-512.png** - 512×512px app icon

Use any tool to create these from your game logo/character.

## 🔧 Development

### Local Testing:
```bash
# Simple HTTP server
python -m http.server 8000

# Or using Node
npx http-server
```

Visit: `http://localhost:8000`

### Testing PWA Features:
1. Open Chrome DevTools (F12)
2. Go to "Application" tab
3. Check "Service Workers" and "Manifest"

## 🌐 Supported Browsers

- ✅ Chrome/Edge (Desktop & Mobile)
- ✅ Firefox (Desktop & Mobile)
- ✅ Safari (Desktop & iOS)
- ✅ Samsung Internet
- ✅ Opera

## ⚡ Performance

- **First Load:** ~2-3 seconds (loads all resources)
- **Offline Load:** <1 second (cached)
- **Game Size:** ~10-15 MB (all assets)

## 🎯 Custom Phrases

Same as desktop version - users can load custom XML files with this format:

```xml
<bollywood_phrases>
    <category name="YOUR CATEGORY">
        <phrase>Your Phrase</phrase>
    </category>
</bollywood_phrases>
```

## 📝 Notes

- Service worker caches all resources for offline play
- Works completely offline after first visit
- Updates automatically when you deploy new version
- No app store approval needed
- Instant updates for all users

## 🐛 Troubleshooting

**PWA not installing:**
- Ensure HTTPS is enabled (Vercel does this automatically)
- Check manifest.json is accessible
- Verify service worker is registered

**Offline not working:**
- Check service worker in DevTools
- Clear cache and reload
- Ensure all paths are correct

**Images/sounds not loading:**
- Check file paths are correct
- Verify files are uploaded
- Check browser console for errors

## 🎊 Ready to Deploy!

1. Add icon-192.png and icon-512.png
2. Run `vercel` in this folder
3. Share the URL with everyone!

---

**Play anywhere, anytime! 🎬🎵**
