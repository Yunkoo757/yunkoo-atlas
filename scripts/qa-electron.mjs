/**
 * 桌面版 QA — 主进程 headless 模式（TRADER_ATLAS_QA=1）
 * 覆盖：SQLite 库、manifest、无损附件、journal.zip 导出
 * UI 流（笔记编辑/粘贴图片）见文末手动清单。
 */
import { runHeadlessElectron } from './headless-electron.mjs'
import { removeTemporaryDirectoryBounded } from './bundle-build-identity.mjs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const electronExe = require('electron')
const ROOT = process.cwd()
const OUT = join(ROOT, 'qa-screenshots-electron')
mkdirSync(OUT, { recursive: true })
const LIB = mkdtempSync(join(tmpdir(), 'trader-atlas-qa-'))
const RESULT = join(LIB, 'qa-result.json')

const results = []

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function readSnapshotFromDb(dbPath) {
  const bytes = readFileSync(dbPath)
  const SQL = await initSqlJs({
    locateFile: (f) => join(ROOT, 'node_modules/sql.js/dist', f),
  })
  const db = new SQL.Database(bytes)
  try {
    const res = db.exec(`SELECT value FROM meta WHERE key = 'snapshot'`)
    if (!res[0]?.values[0]) return null
    return JSON.parse(String(res[0].values[0][0]))
  } finally {
    db.close()
  }
}

try {
  if (!existsSync(join(ROOT, 'dist-electron/main.js'))) {
    throw new Error('请先运行 pnpm build:app')
  }

  const { code, stderr } = await runHeadlessElectron({
    executable: electronExe, root: ROOT, library: LIB,
    environment: { TRADER_ATLAS_QA: '1', TRADER_ATLAS_QA_RESULT: RESULT },
  })
  if (stderr.trim()) console.log(stderr.trim())
  record('Electron headless 退出码', code === 0, `code=${code}`)

  if (!existsSync(RESULT)) {
    throw new Error('未生成 QA 结果文件')
  }

  const payload = JSON.parse(readFileSync(RESULT, 'utf8'))
  if (payload.libraryPath !== LIB || !Array.isArray(payload.checks) || payload.checks.length === 0 ||
      payload.checks.some(check => typeof check.name !== 'string' || typeof check.pass !== 'boolean') ||
      payload.total !== payload.checks.length || payload.passed !== payload.checks.filter(check => check.pass).length) {
    throw new Error('隔离库的 QA 检查结果缺失或不一致')
  }
  for (const check of payload.checks) record(check.name, check.pass, check.detail ?? '')

  const snapshot = await readSnapshotFromDb(join(LIB, 'journal.db'))
  record('外部 sql.js 读取 snapshot', !!snapshot)
  record('外部校验交易条数', (snapshot?.trades?.length ?? 0) > 0, `${snapshot?.trades?.length ?? 0} 条`)
} catch (e) {
  record('QA 异常', false, String(e))
}

try {
  await removeTemporaryDirectoryBounded(LIB)
} catch (error) {
  record('清理隔离测试库', false, `${LIB}：${error.message}`)
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const score = total ? Math.round((passed / total) * 10 * 10) / 10 : 0

console.log('\n--- 桌面版 QA 汇总 ---')
console.log(`库路径: ${LIB}`)
console.log(`通过 ${passed}/${total}，健康分 ${score}/10`)
console.log('\n--- 建议手动验证（渲染层 / CDP 自动化受限）---')
console.log('1. pnpm dev:electron → 编辑笔记 → 出现「已保存」')
console.log('2. 粘贴截图 → 重启应用 → 图片仍在')
console.log('3. 数据 IO → 导出 .journal.zip → 导入到新库')

writeFileSync(
  join(OUT, 'report.json'),
  JSON.stringify({ score, passed, total, libraryPath: LIB, results }, null, 2),
)

process.exitCode = passed === total ? 0 : 1
