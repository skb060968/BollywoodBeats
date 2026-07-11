import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html'
        // single-player.html excluded - not needed for multiplayer deployment
      }
    }
  },
  server: {
    port: 3000
  }
})
