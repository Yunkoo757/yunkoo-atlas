import fs from 'node:fs/promises'
import path from 'node:path'

import { readGitProvenance } from './git-provenance.mjs'
import { finalQualityManifestPassed } from './release-evidence-validation.mjs'

const root = process.cwd()
const manifestPath = path.resolve(process.argv[2] ?? 'test-results/final-quality-evidence/final-quality-manifest.json')

let manifest
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
} catch (error) {
  throw new Error(`无法读取最终质量清单 ${manifestPath}: ${error.message}`)
}

const provenance = await readGitProvenance(root)
if (!finalQualityManifestPassed(manifest, provenance)) {
  throw new Error('最终质量清单未授权发布：状态、门禁、Release Train 或源码身份不匹配')
}

console.log(`Final quality manifest PASS: ${manifest.sourceIdentity}`)
