import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

const isElectron = process.env.ELECTRON === '1'

export default defineConfig({
  plugins: [
    react(),
    isElectron &&
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            resolve: {
              alias: { '@': path.resolve(__dirname, 'src') },
            },
            build: {
              rollupOptions: {
                external: [
                  'electron',
                  'electron-updater',
                  'sharp',
                  'sql.js',
                  'archiver',
                  'extract-zip',
                ],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                },
              },
            },
          },
        },
      }),
  ].filter(Boolean),
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@tiptap/') || id.includes('/node_modules/prosemirror-')) {
            return 'editor-vendor'
          }
          if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) {
            return 'charts-vendor'
          }
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  base: isElectron ? './' : '/',
  server: { port: 5180, open: !isElectron },
})
