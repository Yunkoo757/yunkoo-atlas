import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

/** Each QA listener owns its optimized modules for the entire lifetime of its browser pages. */
export async function startQaServer({ root = process.cwd(), configFile, restrictToRoot = false } = {}) {
  const directory = await realpath(root)
  const output = path.join(directory, 'test-results')
  await mkdir(output, { recursive: true })
  const cacheDir = await mkdtemp(path.join(output, '.vite-qa-'))
  let server

  async function close() {
    try {
      await server?.close()
    } finally {
      await rm(cacheDir, { recursive: true, force: true, maxRetries: 3 })
    }
  }

  try {
    server = await createServer({
      root: directory,
      configFile,
      cacheDir,
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        open: false,
        // 一次验收只服务启动时的配置；配置重载可能在 close() 后重新监听。
        watch: null,
        hmr: false,
        ...(restrictToRoot && { fs: { allow: [directory] } }),
      },
    })
    await server.listen()
    const baseUrl = server.resolvedUrls?.local[0]
    if (!baseUrl) throw new Error('验收服务未提供本地地址')
    return { baseUrl, close }
  } catch (error) {
    await close()
    throw error
  }
}
