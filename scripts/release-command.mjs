import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import path from 'node:path'

function findPnpmCli(env = process.env) {
  const candidates = [
    env.npm_execpath,
    env.PNPM_HOME && path.join(env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    env.APPDATA && path.join(env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

export function resolveCommand(
  name,
  args,
  {
    platform = process.platform,
    nodePath = process.execPath,
    pnpmCli = findPnpmCli(),
  } = {},
) {
  if (platform === 'win32' && name === 'pnpm') {
    if (!pnpmCli) {
      throw new Error('未找到 pnpm CLI 路径，请通过 pnpm release:* 命令执行发布。')
    }
    return { file: nodePath, args: [pnpmCli, ...args] }
  }

  return { file: name, args }
}

export async function runCommand(name, args, env = process.env) {
  const invocation = resolveCommand(name, args)
  const child = spawn(invocation.file, invocation.args, { env, stdio: 'inherit' })
  const [code, signal] = await once(child, 'close')
  if (code !== 0) throw new Error(`命令执行失败（${signal ?? code}）：${name} ${args.join(' ')}`)
}
