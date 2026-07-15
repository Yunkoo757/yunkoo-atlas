import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'vite'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function activeLibraryFiles(root) {
  return {
    database: path.join(root, 'journal.db'),
    manifest: path.join(root, 'manifest.json'),
    attachments: path.join(root, 'attachments'),
  }
}

function assertLibrary(root) {
  const files = activeLibraryFiles(root)
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Library directory does not exist: ${root}`)
  }
  if (!fs.statSync(files.database, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`journal.db does not exist: ${files.database}`)
  }
  if (!fs.statSync(files.manifest, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`manifest.json does not exist: ${files.manifest}`)
  }
  return files
}

function assertTemporaryPath(target) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(target))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove a non-temporary path: ${target}`)
  }
}

function copyAttachments(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`Unexpected non-file attachment entry: ${entry.name}`)
    fs.copyFileSync(path.join(source, entry.name), path.join(destination, entry.name))
  }
}

function assertRunnerBuildPath(target) {
  const relative = path.relative(path.resolve('.'), path.resolve(target))
  if (!relative.startsWith('.tmp-rehearse-library-upgrade-') || relative.includes(path.sep)) {
    throw new Error(`Refusing to remove an unexpected runner path: ${target}`)
  }
}

async function buildRunner(outDir) {

  await build({
    configFile: path.resolve('vite.config.ts'),
    logLevel: 'error',
    build: {
      ssr: path.resolve('scripts/rehearse-library-upgrade-entry.ts'),
      outDir,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
  })
  return path.join(outDir, 'runner.mjs')
}

export async function rehearseLibraryUpgrade(sourceRoot) {
  const source = path.resolve(sourceRoot)
  const sourceFiles = assertLibrary(source)
  const sourceBefore = {
    databaseSha256: sha256(sourceFiles.database),
    manifestSha256: sha256(sourceFiles.manifest),
  }
  const rehearsalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-v7-rehearsal-'))
  const runnerOutDir = path.resolve(`.tmp-rehearse-library-upgrade-${process.pid}-${Date.now()}`)
  const copiedFiles = activeLibraryFiles(rehearsalRoot)

  try {
    fs.copyFileSync(sourceFiles.database, copiedFiles.database)
    fs.copyFileSync(sourceFiles.manifest, copiedFiles.manifest)
    if (fs.statSync(sourceFiles.attachments, { throwIfNoEntry: false })?.isDirectory()) {
      copyAttachments(sourceFiles.attachments, copiedFiles.attachments)
    }

    const runnerPath = await buildRunner(runnerOutDir)
    const runner = await import(`${pathToFileURL(runnerPath).href}?run=${Date.now()}`)
    const upgrade = await runner.runUpgrade(rehearsalRoot)
    const sourceAfter = {
      databaseSha256: sha256(sourceFiles.database),
      manifestSha256: sha256(sourceFiles.manifest),
    }
    const sourceUnchanged =
      sourceBefore.databaseSha256 === sourceAfter.databaseSha256
      && sourceBefore.manifestSha256 === sourceAfter.manifestSha256
    const countsPreserved =
      JSON.stringify(upgrade.beforeCounts) === JSON.stringify(upgrade.afterCounts)
      && JSON.stringify(upgrade.afterCounts) === JSON.stringify(upgrade.reopenedCounts)
    const passed =
      sourceUnchanged
      && countsPreserved
      && upgrade.toVersion === 7
      && upgrade.pendingRecoveryArtifacts.length === 0

    return {
      generatedAt: new Date().toISOString(),
      source,
      copiedActiveLibraryOnly: true,
      sourceUnchanged,
      countsPreserved,
      sourceBefore,
      sourceAfter,
      upgrade,
      passed,
    }
  } finally {
    assertRunnerBuildPath(runnerOutDir)
    fs.rmSync(runnerOutDir, { recursive: true, force: true })
    assertTemporaryPath(rehearsalRoot)
    fs.rmSync(rehearsalRoot, { recursive: true, force: true })
  }
}

async function main() {
  const source = argument('--source')
  if (!source) throw new Error('Usage: node scripts/rehearse-library-upgrade.mjs --source <library-directory>')
  const report = await rehearseLibraryUpgrade(source)
  const outputDir = path.join(os.tmpdir(), 'yunkoo-atlas', 'migration-rehearsal')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `v7-${Date.now()}.json`)
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.stderr.write(`migration rehearsal report: ${outputPath}\n`)
  if (!report.passed) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()
