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
