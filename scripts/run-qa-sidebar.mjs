import { spawnSync } from 'node:child_process'

for (let attempt = 0; attempt < 2; attempt += 1) {
  const result = spawnSync(process.execPath, ['scripts/qa-sidebar-navigation.mjs'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  if (result.status === 0 && !result.error) process.exit(0)
  if (attempt === 0) console.warn('侧栏 QA 首次运行失败，使用全新进程重试一次。')
}

process.exitCode = 1
