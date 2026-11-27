import { runCommand } from './release-command.mjs'

// 交易日边界与真值门禁按业务时区冻结，避免 UTC runner 误伤 06:00 口径。
process.env.TZ ||= 'Asia/Shanghai'

await runCommand('pnpm', ['test'])
await runCommand('pnpm', ['qa:design'])
await runCommand('pnpm', ['typecheck'])
await runCommand('pnpm', ['exec', 'tsc', '-p', 'tools/atlas-data-editor/tsconfig.json', '--pretty', 'false'])
