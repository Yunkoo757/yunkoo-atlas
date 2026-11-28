import fs from 'node:fs/promises'
import path from 'node:path'
import { startQaServer } from './qa-vite-server.mjs'

import { assertLocalSourceUnchanged, readGitProvenance } from './git-provenance.mjs'
import { runCommand } from './release-command.mjs'
import { releaseQaCommands } from './release-qa-plan.mjs'

const root = process.cwd()
const mode = process.argv.includes('--full') ? 'full' : 'smoke'
const reportPath = path.join(root, 'test-results', `qa-release-${mode}.json`)
await fs.rm(reportPath, { force: true })
const provenance = await readGitProvenance(root)

// Preserve the caller's build environment across Vite's development-mode setup.
const environment = { ...process.env, TZ: process.env.TZ || 'Asia/Shanghai' }
// Standalone probes can choose a URL. Release checks must serve this checkout's development and production builds.
delete environment.QA_BASE_URL
delete environment.QA_WORKBENCH_PROBE_URL
const commands = []
for (const command of releaseQaCommands(mode)) {
  if (command === 'qa' || command === 'qa:core') {
    const server = await startQaServer({ root })
    try {
      await runCommand('pnpm', [command], { ...environment, QA_BASE_URL: new URL(server.baseUrl).origin })
    } finally {
      await server.close()
    }
  } else if (command === 'qa:dashboard-10k') {
    // Reuse the Electron build produced above. The standalone package command builds again.
    await runCommand(process.execPath, ['scripts/qa-dashboard-10k.mjs'], environment)
  } else {
    await runCommand('pnpm', [command], environment)
  }
  commands.push(command)
}

await fs.mkdir(path.dirname(reportPath), { recursive: true })
assertLocalSourceUnchanged(provenance, await readGitProvenance(root))
await fs.writeFile(reportPath, JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  mode,
  status: 'pass',
  ...provenance,
  commands,
}, null, 2) + '\n', 'utf8')
