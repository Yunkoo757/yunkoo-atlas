import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const tokens = read('src/styles/tokens.css')
const globalStyles = read('src/styles/global.css')
const emptyStateStyles = read('src/components/EmptyState.css')
const editorStyles = read('src/editor/Editor.css')
const strategyModalStyles = read('src/components/StrategyFormModal.css')
const statusIconStyles = read('src/icons/linear/status/linearStatusIcons.css')
const statusIconComponent = read('src/components/StatusIcon.tsx')
const buttonStyles = read('src/components/ui/Button.css')
const crumbsStyles = read('src/components/ui/CrumbsNav.css')
const toolbarStyles = read('src/components/ui/Toolbar.css')
const tagPresetStyles = read('src/views/settings/TagPresetsPanel.css')
const sidebarStyles = read('src/components/Sidebar.css')
const sidebarComponent = read('src/components/Sidebar.tsx')
const sidebarWorkspaceStyles = read('src/components/sidebar/SidebarWorkspace.css')
const tradeListStyles = read('src/components/trades/TradeList.css')
const tradeListComponent = read('src/components/trades/TradeList.tsx')
const app = read('src/App.tsx')
const tradesPageStart = app.indexOf('function TradesPage(')
const tradesPageEnd = app.indexOf('\nfunction StrategyPage()', tradesPageStart)
const tradesPage =
  tradesPageStart >= 0 && tradesPageEnd > tradesPageStart
    ? app.slice(tradesPageStart, tradesPageEnd)
    : null

const checks = [
  ['sidebar width', tokens.includes('--sidebar-width: 244px')],
  [
    'sidebar navigation matches measured Linear hierarchy',
    sidebarStyles.includes('--sb-text: lch(60.307% 1 272)') &&
      /\.sb-item\s*\{[^}]*height:\s*28px;[^}]*font-size:\s*var\(--fs-sm\);[^}]*font-weight:\s*var\(--font-weight-medium\);[^}]*color:\s*var\(--sb-text\);/s.test(sidebarStyles) &&
      /\.sb-section-label\s*\{[^}]*height:\s*28px;[^}]*font-size:\s*var\(--fs-mini\);/s.test(sidebarStyles),
  ],
  [
    'sidebar avatar uses the Linear rounded-square shape',
    /\.sb-ws-avatar\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*border-radius:\s*var\(--radius-8\);/s.test(sidebarStyles) &&
      sidebarComponent.includes('shape="rounded-square"'),
  ],
  ['control height', tokens.includes('--control-height: 28px')],
  ['trade row height', tokens.includes('--trade-row-height: 44px')],
  [
    'default trade route uses canonical list',
    tradesPage !== null && tradesPage.includes('<ListView'),
  ],
  [
    'native form controls inherit the UI font',
    /:where\(\s*input:not\(\[type\]\)[^}]+\)\s*\{[^}]*font-family:\s*inherit;/s.test(globalStyles),
  ],
  [
    'native buttons inherit the UI font size',
    /button\s*\{[^}]*font-size:\s*inherit;/s.test(globalStyles),
  ],
  [
    'empty state motion uses the shared duration token',
    emptyStateStyles.includes('animation: fadeIn var(--dur-slow) var(--ease-out) both'),
  ],
  [
    'interactive transitions avoid transition all',
    !editorStyles.includes('transition: all') &&
      !strategyModalStyles.includes('transition: all') &&
      !statusIconStyles.includes('transition: all'),
  ],
  [
    'trade status animation has a single owner',
    statusIconComponent.includes('animate={false}'),
  ],
  [
    'reduced motion globally suppresses non-essential animation',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.001ms !important;[\s\S]*transition-duration:\s*0\.001ms !important;/s.test(globalStyles),
  ],
  [
    'disabled primary actions use a quiet semantic state',
    buttonStyles.includes('.ui-btn-primary:disabled') &&
      buttonStyles.includes('opacity: 1'),
  ],
  [
    'active breadcrumbs match the topbar title weight',
    /\.crumbs-label\.is-active\s*\{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s.test(crumbsStyles),
  ],
  [
    'meaningful metadata stays above the disabled contrast tier',
    /\.ui-toolbar-context\s*\{[^}]*color:\s*var\(--text-tertiary\)/s.test(toolbarStyles) &&
      /\.crumbs-context\s*\{[^}]*color:\s*var\(--text-tertiary\)/s.test(crumbsStyles) &&
      /\.tag-section-empty\s*\{[^}]*color:\s*var\(--text-tertiary\)/s.test(tagPresetStyles),
  ],
  [
    'sidebar workspace menu keeps a 24px pointer target',
    /\.sb-workspace-menu\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s.test(sidebarWorkspaceStyles),
  ],
  [
    'trade chips use the calibrated Inter rasterization',
    /\.trade-row-tag,[\s\S]*?font-family:\s*var\(--font-regular\);[\s\S]*?font-size:\s*var\(--fs-micro\);[\s\S]*?font-feature-settings:\s*normal;/s.test(
      tradeListStyles,
    ),
  ],
  [
    'trade group counts match Linear numeric metrics',
    /\.trade-list-group-count\s*\{[^}]*font-family:\s*var\(--font-regular\);[^}]*font-size:\s*var\(--fs-sm\);[^}]*font-weight:\s*450;[^}]*font-feature-settings:\s*normal;[^}]*font-variant-numeric:\s*tabular-nums;/s.test(
      tradeListStyles,
    ),
  ],
  [
    'virtual trade rows preserve native text rasterization',
    tradeListComponent.includes("top: isSticky ? 0 : virtualRow.start") &&
      !tradeListComponent.includes('translateY(${virtualRow.start}px)'),
  ],
]

const failed = checks.filter(([, ok]) => !ok)

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
}

if (failed.length > 0) {
  process.exitCode = 1
} else {
  console.log('PASS: Linear design contract')
}
