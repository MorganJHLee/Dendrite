import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
    }),
    {
      name: 'copy-pdf-worker',
      buildStart() {
        // Copy worker to public folder for dev mode
        const workerSrc = path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js')
        const publicWorkerDest = path.resolve(__dirname, 'public/pdf.worker.min.js')
        try {
          mkdirSync(path.dirname(publicWorkerDest), { recursive: true })
          copyFileSync(workerSrc, publicWorkerDest)
          console.log('Copied PDF.js worker to public/')
        } catch (err) {
          console.error('Failed to copy PDF.js worker to public:', err)
        }
      },
      closeBundle() {
        // Copy worker to dist folder for production build
        const workerSrc = path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js')
        const workerDest = path.resolve(__dirname, 'dist/pdf.worker.min.js')
        try {
          mkdirSync(path.dirname(workerDest), { recursive: true })
          copyFileSync(workerSrc, workerDest)
          console.log('Copied PDF.js worker to dist/')
        } catch (err) {
          console.error('Failed to copy PDF.js worker:', err)
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // Don't exclude pdfjs-dist - let Vite optimize it
    // This helps with proper module resolution in Electron
    include: ['pdfjs-dist'],
  },
})
