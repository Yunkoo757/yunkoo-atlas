import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const isElectron = process.env.ELECTRON === '1'
/** 默认开放完整安全清理链路；紧急回滚时显式注入 false。 */
const assetPurgeCommitFlag = process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT === 'false' ? 'false' : 'true'

function git(args: string[]) {
  return execFileSync('git', args, {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const embeddedCommit = git(['rev-parse', 'HEAD']).toLowerCase()
if (!/^[0-9a-f]{40}$/.test(embeddedCommit)) {
  throw new Error('Unable to derive a valid repository HEAD for the embedded build identity')
}
const embeddedBuildIdentity = Object.freeze({
  commit: embeddedCommit,
  dirty: git(['status', '--porcelain=v1', '--untracked-files=normal']).length > 0,
})

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
              '__ATLAS_BUILD_IDENTITY__': JSON.stringify(embeddedBuildIdentity),
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
  define: {
    '__ATLAS_BUILD_IDENTITY__': JSON.stringify(embeddedBuildIdentity),
  },
  base: isElectron ? './' : '/',
  build: { manifest: true },
  // 本项目仅面向 Windows/macOS 桌面端；开发或 QA 服务不得自动唤起浏览器。
  server: { port: 5180, open: false },
})
