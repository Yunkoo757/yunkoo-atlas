import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const tokens = read('src/styles/tokens.css')
const globalStyles = read('src/styles/global.css')
const emptyStateStyles = read('src/components/EmptyState.css')
const editorStyles = read('src/editor/Editor.css')
const strategyModalStyles = read('src/components/StrategyFormModal.css')
const statusIconStyles = read('src/icons/linear/status/linearStatusIcons.css')
const statusIconComponent = read('src/components/StatusIcon.tsx')
const filterBarStyles = read('src/components/ui/FilterBar.css')
const buttonStyles = read('src/components/ui/Button.css')
const quickViewStyles = read('src/components/trades/QuickViewBar.css')
const topbarStyles = read('src/components/Topbar.css')
const crumbsStyles = read('src/components/ui/CrumbsNav.css')
const toolbarStyles = read('src/components/ui/Toolbar.css')
const tagPresetStyles = read('src/views/settings/TagPresetsPanel.css')
const settingsLayoutStyles = read('src/views/settings/SettingsLayout.css')
const settingsDataPanel = read('src/views/settings/DataSettingsPanel.tsx')
const updatesPanelStyles = read('src/views/settings/UpdatesSettingsPanel.css')
const dioContentStyles = read('src/components/DataIOContent.css')
const symbolsPanelStyles = read('src/views/settings/SymbolsPanel.css')
const reviewTemplatesStyles = read('src/views/settings/ReviewTemplatesPanel.css')
const shortcutsViewCss = read('src/views/ShortcutsView.css')
const strategiesViewCss = read('src/views/StrategiesView.css')
const buttonCss = read('src/components/ui/Button.css')
const displayMenuCss = read('src/components/DisplayMenu.css')
const profileSettingsCss = read('src/views/settings/ProfileSettingsPanel.css')
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
    sidebarStyles.includes('--sb-text: var(--text-tertiary)') &&
      /\.sb-item\s*\{[^}]*height:\s*var\(--control-height\);[^}]*font-size:\s*var\(--fs-sm\);[^}]*font-weight:\s*var\(--font-weight-medium\);[^}]*color:\s*var\(--sb-text\);/s.test(sidebarStyles) &&
      /\.sb-section-label\s*\{[^}]*height:\s*24px;[^}]*font-size:\s*var\(--fs-mini\);/s.test(sidebarStyles),
  ],
  [
    'sidebar avatar uses the Linear rounded-square shape',
    /\.sb-ws-avatar\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border-radius:\s*var\(--radius-8\);/s.test(sidebarStyles) &&
      sidebarComponent.includes('shape="rounded-square"') &&
      sidebarComponent.includes("label: '设置'") &&
      sidebarComponent.includes('navigate(\'/trade-trash\')') &&
      !sidebarComponent.includes('sb-utility'),
  ],
  ['control height', tokens.includes('--control-height: 28px')],
  ['field height md', tokens.includes('--field-height-md: 32px')],
  [
    'portaled UI keeps the calibrated Linear font',
    tokens.includes('--font-ui: var(--font-linear-ui)') &&
      /\.hover-preview-pop\s*\{[^}]*--font-ui:\s*var\(--font-linear-ui\);[^}]*font-family:\s*var\(--font-ui\);/s.test(
        read('src/components/HoverPreview.css'),
      ),
  ],
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
    'trade chips match the quick-filter typography',
    /\.trade-row-tag,[\s\S]*?font-family:\s*var\(--font-ui\);[\s\S]*?font-size:\s*var\(--fs-mini\);[\s\S]*?font-weight:\s*500;[\s\S]*?font-feature-settings:\s*normal;/s.test(
      tradeListStyles,
    ),
  ],
  [
    'filter chips match the quick-view typography',
    /\.ui-filter-trigger,\s*\n\.ui-filter-chip\s*\{[^}]*font-family:\s*var\(--font-ui\);[^}]*font-size:\s*var\(--fs-mini\);[^}]*font-weight:\s*500;/s.test(
      filterBarStyles,
    ) &&
      /\.quick-view-chip,\s*\n\.quick-view-overflow\s*\{[^}]*font-family:\s*var\(--font-ui\);[^}]*font-size:\s*var\(--fs-mini\);[^}]*font-weight:\s*500;/s.test(
        quickViewStyles,
      ) &&
      /\.tb-btn\s*\{[^}]*font-family:\s*var\(--font-ui\);[^}]*font-size:\s*var\(--fs-mini\);[^}]*font-weight:\s*var\(--font-weight-medium\);/s.test(
        topbarStyles,
      ) &&
      /\.ui-btn,[\s\S]*?font-family:\s*var\(--font-ui\);[\s\S]*?font-size:\s*var\(--fs-mini\);[\s\S]*?font-weight:\s*var\(--font-weight-medium\);/s.test(
        buttonStyles,
      ),
  ],
  [
    'trade group counts match Linear numeric metrics',
    /\.trade-list-group-count\s*\{[^}]*font-family:\s*var\(--font-ui\);[^}]*font-size:\s*var\(--fs-sm\);[^}]*font-weight:\s*var\(--font-weight-normal\);[^}]*font-feature-settings:\s*normal;[^}]*font-variant-numeric:\s*tabular-nums;/s.test(
      tradeListStyles,
    ),
  ],
  [
    'virtual trade rows preserve native text rasterization',
    tradeListComponent.includes("top: isSticky ? 0 : virtualRow.start") &&
      !tradeListComponent.includes('translateY(${virtualRow.start}px)'),
  ],

  // ── settings 页设计 token 契约（2026-07-24 审计修复后新增）──
  [
    'settings section title uses type-section-title tokens',
    /\.settings-section-title\s*\{[^}]*font-size:\s*var\(--type-section-title-size\);[^}]*font-weight:\s*var\(--type-section-title-weight\);/s.test(
      settingsLayoutStyles,
    ),
  ],
  [
    'dio section title also uses type-section-title tokens',
    /\.dio-section-title\s*\{[^}]*font-size:\s*var\(--type-section-title-size\);[^}]*font-weight:\s*var\(--type-section-title-weight\);/s.test(
      dioContentStyles,
    ),
  ],
  [
    'dio group title also uses type-section-title tokens',
    /\.dio-group-title\s*\{[^}]*font-size:\s*var\(--type-section-title-size\);[^}]*font-weight:\s*var\(--type-section-title-weight\);/s.test(
      dioContentStyles,
    ),
  ],
  [
    'updates section h2 uses type-section-title tokens',
    /\.update-section-head h2\s*\{[^}]*font-size:\s*var\(--type-section-title-size\);[^}]*font-weight:\s*var\(--type-section-title-weight\);/s.test(
      updatesPanelStyles,
    ),
  ],
  [
    'review pin setting h2 uses type-section-title tokens',
    /\.review-pin-setting h2\s*\{[^}]*font-size:\s*var\(--type-section-title-size\);[^}]*font-weight:\s*var\(--type-section-title-weight\);/s.test(
      reviewTemplatesStyles,
    ),
  ],
  [
    'settings nav item height uses field-height-md',
    /\.settings-nav-item\s*\{[^}]*height:\s*var\(--field-height-md\);/s.test(settingsLayoutStyles),
  ],
  [
    'DataSettingsPanel has no inline style props',
    !settingsDataPanel.includes('style={{'),
  ],
  [
    'Symbols preset swatch uses fs-micro (not bare 10px)',
    !symbolsPanelStyles.includes('font-size: 10px') &&
      /\.symbols-preset-swatch\s*\{[^}]*font-size:\s*var\(--fs-micro\);/s.test(symbolsPanelStyles),
  ],
  [
    'Tag chip remove uses radius-full (not bare 50%)',
    !tagPresetStyles.includes('border-radius: 50%') &&
      /\.settings-tag-chip-remove\s*\{[^}]*border-radius:\s*var\(--radius-full\);/s.test(tagPresetStyles),
  ],
  [
    'settings CSS uses --sp-* spacing tokens',
    /var\(--sp-/s.test(settingsLayoutStyles) ||
      /var\(--sp-/s.test(dioContentStyles) ||
      /var\(--sp-/s.test(updatesPanelStyles),
  ],

  // ── settings 深度 QA 契约（2026-07-24 第二轮修复后新增）──
  [
    'ShortcutsView.css has no dead .shortcuts-view class',
    !shortcutsViewCss.includes('.shortcuts-view {'),
  ],
  [
    'ShortcutsView.css has no dead .shortcuts-toolbar class',
    !shortcutsViewCss.includes('.shortcuts-toolbar {'),
  ],
  [
    'ShortcutsView.css has no dead .shortcuts-back class',
    !shortcutsViewCss.includes('.shortcuts-back {'),
  ],
  [
    'StrategiesView.css has no dead .st-title class',
    !strategiesViewCss.includes('.st-title {'),
  ],
  [
    'StrategiesView.css has no dead .st-foot class',
    !strategiesViewCss.includes('.st-foot {'),
  ],
  [
    'no --radius-12 or --radius-16 naming mismatch anywhere in src',
    !read('src/styles/tokens.css').includes('--radius-12') &&
      !read('src/styles/tokens.css').includes('--radius-16'),
  ],
  [
    'Button.css has no hardcoded white in color-mix',
    !buttonCss.includes('white 12%'),
  ],
  [
    'ProfileSettingsPanel.css has no hardcoded white in color-mix',
    !profileSettingsCss.includes('white 12%'),
  ],
  [
    'DisplayMenu.css animation uses token duration (not bare 0.12s)',
    !displayMenuCss.includes('0.12s') && /var\(--motion-ui\)/.test(displayMenuCss),
  ],
  [
    'ShortcutsView.css animation uses var(--ease-in-out) token',
    shortcutsViewCss.includes('var(--ease-in-out)') &&
      !shortcutsViewCss.replace('var(--ease-in-out)', '').includes('ease-in-out'),
  ],
];

const failed = checks.filter(([, ok]) => !ok)

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
}

if (failed.length > 0) {
  process.exitCode = 1
} else {
  console.log('PASS: Linear design contract')
}
