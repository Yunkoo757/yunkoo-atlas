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
              rolldownOptions: {
                external: [
                  'electron',
                  'electron-updater',
                  'sharp',
                  'sql.js',
                  'archiver',
                  'yauzl',
                ],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              rolldownOptions: {
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
  base: isElectron ? './' : '/',
  build: { manifest: true },
  server: { port: 5180, open: !isElectron },
})
