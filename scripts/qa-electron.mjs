/**
 * 桌面版 QA — 主进程 headless 模式（LINEAR_JOURNAL_QA=1）
 * 覆盖：SQLite 库、manifest、sharp 附件、journal.zip 导出
 * UI 流（笔记编辑/粘贴图片）见文末手动清单。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const electronExe = require('electron')
const ROOT = process.cwd()
const OUT = join(ROOT, 'qa-screenshots-electron')
const LIB = join(tmpdir(), `linear-journal-qa-${Date.now()}`)
const RESULT = join(LIB, 'qa-result.json')

const results = []

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function readSnapshotFromDb(dbPath) {
  const SQL = await initSqlJs({
    locateFile: (f) => join(ROOT, 'node_modules/sql.js/dist', f),
  })
  const db = new SQL.Database(readFileSync(dbPath))
  const res = db.exec(`SELECT value FROM meta WHERE key = 'snapshot'`)
  if (!res[0]?.values[0]) return null
  return JSON.parse(String(res[0].values[0][0]))
}

function runElectronQa() {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExe, ['.'], {
      cwd: ROOT,
      env: {
        ...process.env,
        LINEAR_JOURNAL_LIBRARY: LIB,
        LINEAR_JOURNAL_QA: '1',
        LINEAR_JOURNAL_QA_RESULT: RESULT,
        VITE_DEV_SERVER_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, stderr }))
  })
}

mkdirSync(OUT, { recursive: true })
mkdirSync(LIB, { recursive: true })

try {
  if (!existsSync(join(ROOT, 'dist-electron/main.js'))) {
    throw new Error('请先运行 pnpm build:app')
  }

  const { code, stderr } = await runElectronQa()
  if (stderr.trim()) console.log(stderr.trim())
  record('Electron headless 退出码', code === 0, `code=${code}`)

  if (!existsSync(RESULT)) {
    throw new Error('未生成 QA 结果文件')
  }

  const payload = JSON.parse(readFileSync(RESULT, 'utf8'))
  for (const c of payload.checks ?? []) {
    record(c.name, c.pass, c.detail ?? '')
  }

  // 外部 sql.js 二次校验 journal.db
  const dbPath = join(LIB, 'journal.db')
  if (existsSync(dbPath)) {
    const snapshot = await readSnapshotFromDb(dbPath)
    record('外部 sql.js 读取 snapshot', !!snapshot)
    record(
      '外部校验交易条数',
      (snapshot?.trades?.length ?? 0) > 0,
      `${snapshot?.trades?.length ?? 0} 条`,
    )
  }
} catch (e) {
  record('QA 异常', false, String(e))
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

try {
  rmSync(LIB, { recursive: true, force: true })
} catch {
  console.log(`保留测试库: ${LIB}`)
}

process.exitCode = passed === total ? 0 : 1
