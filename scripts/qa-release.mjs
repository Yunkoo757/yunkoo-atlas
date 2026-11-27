import fs from 'node:fs/promises'
import path from 'node:path'
import { startQaServer } from './qa-vite-server.mjs'

import { assertLocalSourceUnchanged, readGitProvenance } from './git-provenance.mjs'
import { runCommand } from './release-command.mjs'

const root = process.cwd()
const full = process.argv.includes('--full')
const reportPath = path.join(root, 'test-results', full ? 'qa-release-full.json' : 'qa-release-smoke.json')
await fs.rm(reportPath, { force: true })
const provenance = await readGitProvenance(root)

// Preserve the caller's build environment across Vite's development-mode setup.
const environment = { ...process.env, TZ: process.env.TZ || 'Asia/Shanghai' }
// Standalone probes can choose a URL. Release checks must serve this checkout's development and production builds.
delete environment.QA_BASE_URL
delete environment.QA_WORKBENCH_PROBE_URL
const commands = []
async function pnpm(script, env = environment) {
  await runCommand('pnpm', [script], env)
  commands.push(script)
}

await pnpm('qa:ci')
const server = await startQaServer({ root })
try {
  await pnpm(full ? 'qa' : 'qa:core', { ...environment, QA_BASE_URL: new URL(server.baseUrl).origin })
} finally {
  await server.close()
}

await pnpm('build:app')
await pnpm('test:storage-recovery:electron')
if (full) {
  await runCommand(process.execPath, ['scripts/qa-dashboard-10k.mjs'], environment)
  commands.push('qa:dashboard-10k')
}
await pnpm('qa:electron')

await fs.mkdir(path.dirname(reportPath), { recursive: true })
assertLocalSourceUnchanged(provenance, await readGitProvenance(root))
await fs.writeFile(reportPath, JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  mode: full ? 'full' : 'smoke',
  status: 'pass',
  ...provenance,
  commands,
}, null, 2) + '\n', 'utf8')
