import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The three.js vendor chunk below is irreducibly large on its own (grew
    // past 1000kB once drei's Html was added for InfoTooltips) — this just
    // stops the build from warning about a split that's already the
    // intended fix, not a size we're failing to control.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three.js + r3f/drei dominate the bundle and change far less often
        // than the app's own code — splitting them into their own chunk
        // lets browsers cache that chunk across deploys that only touch
        // app code, instead of invalidating everything on every release.
        manualChunks(id) {
          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three')
          ) {
            return 'three'
          }
        },
      },
    },
  },
})
