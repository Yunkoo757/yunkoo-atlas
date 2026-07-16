import { spawn, spawnSync } from 'node:child_process'
import { resolveCommand } from './release-command.mjs'

const PORT = 5181
const BASE = `http://127.0.0.1:${PORT}`

function run(name, args, env = process.env) {
  const invocation = resolveCommand(name, args)
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0 || result.error) {
    if (result.error) console.error(result.error.message)
    throw new Error(`命令执行失败：${name} ${args.join(' ')}`)
  }
}

function startVite() {
  return spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: process.cwd(), stdio: 'ignore' },
  )
}

async function waitForVite(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Vite 在就绪前退出，退出码 ${child.exitCode}。`)
    }
    try {
      const response = await fetch(BASE)
      if (response.ok && (await response.text()).includes('/@vite/client')) return
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Vite 在 12 秒内未就绪。')
}

async function stopVite(child) {
  if (child.exitCode !== null) return
  const stopped = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1500))])
}

run('pnpm', ['test'])
run('pnpm', ['qa:design'])
run('pnpm', ['qa:sidebar'])

const vite = startVite()
try {
  await waitForVite(vite)
  const qaEnv = { ...process.env, QA_BASE_URL: BASE }
  run('pnpm', ['qa'], qaEnv)
  run('pnpm', ['qa:linear'], qaEnv)
} finally {
  await stopVite(vite)
}

run('pnpm', ['build:app'])
run(process.execPath, ['scripts/qa-dashboard-10k.mjs'])
run('pnpm', ['qa:electron'])
