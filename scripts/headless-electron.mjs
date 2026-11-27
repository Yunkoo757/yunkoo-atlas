import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { removeTemporaryDirectoryBounded } from './bundle-build-identity.mjs'

export async function runHeadlessElectron({ executable, root, library, environment, onSpawn, timeoutMs }) {
  if (!path.isAbsolute(library)) throw new Error('Electron QA requires an explicit isolated library path')
  const profile = await mkdtemp(path.join(os.tmpdir(), 'atlas-headless-profile-'))
  let timer
  try {
    const env = { ...process.env, ...environment, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '' }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, ['.', `--user-data-dir=${profile}`], {
      cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const closed = once(child, 'close')
    let failure
    let stderr = ''
    const messages = []
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('message', message => { messages.push(message) })
    child.once('spawn', () => {
      try {
        onSpawn?.(child)
      } catch (error) {
        failure = error
        child.kill('SIGKILL')
      }
    })
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        failure = new Error(`Electron QA 子进程在 ${timeoutMs}ms 内未退出`)
        child.kill('SIGKILL')
      }, timeoutMs)
    }
    const [code, signal] = await closed
    if (failure) throw failure
    const childError = messages.find(message => message?.type === 'error')
    if (childError) throw new Error(childError.message)
    return { code, signal, pid: child.pid, messages, stderr }
  } finally {
    clearTimeout(timer)
    await removeTemporaryDirectoryBounded(profile)
  }
}
