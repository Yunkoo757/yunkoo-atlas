import { spawnSync } from 'node:child_process'
import { resolveCommand } from './release-command.mjs'

// 交易日边界与真值门禁按业务时区冻结，避免 UTC runner 误伤 06:00 口径。
process.env.TZ ||= 'Asia/Shanghai'

function run(name, args) {
  const invocation = resolveCommand(name, args)
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0 || result.error) {
    if (result.error) console.error(result.error.message)
    throw new Error(`命令执行失败：${name} ${args.join(' ')}`)
  }
}

run('pnpm', ['test'])
run('pnpm', ['qa:design'])
run('pnpm', ['typecheck'])
