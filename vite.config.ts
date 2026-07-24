import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

const isElectron = process.env.ELECTRON === '1'
/** Release 3 kill switch：仅当构建时显式注入 true 才烘焙进主进程。 */
const assetPurgeCommitFlag = process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT === 'true' ? 'true' : ''

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
            define: {
              'process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT': JSON.stringify(assetPurgeCommitFlag),
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
