import fs from 'node:fs/promises'
import { resolveWorkbenchEmptyState } from './workbenchEmptyState'
import { userFacingErrorMessage } from './userFacingError'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testWorkspaceEmptyStateDoesNotClaimTheWholeLibraryIsEmpty(): void {
  const state = resolveWorkbenchEmptyState({
    totalCount: 3,
    workspaceCount: 0,
    visibleCount: 0,
    recordKind: 'paper',
  })
  assert(state?.title === '当前工作区暂无模拟盘记录', '其他工作区有数据时不得宣称整库没有记录')
}

export function testLowLevelEnglishErrorsUseAChineseFallback(): void {
  assert(
    userFacingErrorMessage(new Error('ENOENT: no such file or directory'), '资料库暂时无法读取') === '资料库暂时无法读取',
    'errno 与纯英文底层错误不得直接显示给用户',
  )
  assert(
    userFacingErrorMessage(new Error('资料库版本过新，请更新软件'), '读取失败') === '资料库版本过新，请更新软件',
    '已经可理解的中文业务错误应保留',
  )
}

export async function testPrimaryProductTermsStayConsistent(): Promise<void> {
  const sources = await Promise.all([
    fs.readFile('src/lib/sidebarNavContract.ts', 'utf8'),
    fs.readFile('src/lib/sidebarWorkspace.ts', 'utf8'),
    fs.readFile('src/lib/pageCopy.ts', 'utf8'),
    fs.readFile('src/components/CommandPalette.tsx', 'utf8'),
    fs.readFile('src/components/NotionImportModal.tsx', 'utf8'),
    fs.readFile('src/lib/csvImport.ts', 'utf8'),
  ])
  const visibleCopy = sources.join('\n')
  assert(!visibleCopy.includes('模拟回测'), '主导航、页面标题与导入入口应统一称为“模拟盘”')
  assert(!visibleCopy.includes("label: '标的'"), '面向用户的字段名应统一称为“品种”')
  assert(!visibleCopy.includes('<th>标的</th>'), '导入预览表头应统一称为“品种”')
}

export async function testCombinedDashboardScopeNamesBothDataSources(): Promise<void> {
  const dashboard = await fs.readFile('src/views/Dashboard.tsx', 'utf8')
  assert(dashboard.includes("{ value: 'paper', label: '模拟盘' }"), '仪表盘模拟范围必须使用统一术语')
  assert(dashboard.includes("{ value: 'all', label: '实盘 + 模拟盘' }"), '合并统计必须明确包含实盘与模拟盘')
  assert(!dashboard.includes("label: '全部类型'"), '合并统计不得继续使用无法判断口径的“全部类型”')
}

export async function testDataSettingsFailuresKeepDiagnostics(): Promise<void> {
  const source = await fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8')
  assert(source.includes('reportDataSettingsFailure'), '数据设置失败必须保留诊断上下文')
  assert(!source.includes('catch { /* ignore */ }'), '刷新备份失败不得完全静默')
}
