import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html',
        singlePlayer: 'single-player.html'
      }
    }
  },
  server: {
    port: 3000
  }
})
