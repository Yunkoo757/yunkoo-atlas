export const teachingTrade = {
  ref: 'TRD-教学-01',
  symbol: 'BTCUSDT',
  direction: '做多',
  status: '计划中',
  timeframe: '4H',
  strategy: 'QA 自动化',
  tags: ['仓位大小错误', '情绪化交易'],
  openedAt: '2026-09-05',
  scope: 'live',
};

export const teachingStats = {
  live: {
    label: '实盘',
    trades: '12',
    winRate: '58%',
    result: '+2.4R',
    note: '只统计已完成的实盘记录',
    tone: 'positive',
  },
  paper: {
    label: '模拟盘',
    trades: '8',
    winRate: '50%',
    result: '+0.8R',
    note: '独立来源，不计入实盘绩效',
    tone: 'pending',
  },
  all: {
    label: '全部记录',
    trades: '20',
    winRate: '55%',
    result: '+3.2R',
    note: '包含已选范围内的实盘与模拟盘',
    tone: 'positive',
  },
  missed: {
    label: '错过机会',
    trades: '3',
    winRate: '—',
    result: '不计入',
    note: '用于复盘判断，不计入实盘绩效',
    tone: 'opportunity',
  },
};

export const sourceCards = [
  {
    id: 'live',
    label: '实盘',
    description: '真实执行的交易事实',
    scope: '进入实盘统计',
    tone: 'live',
  },
  {
    id: 'paper',
    label: '模拟盘',
    description: '练习策略与执行，不动用真实仓位',
    scope: '独立统计',
    tone: 'paper',
  },
  {
    id: 'missed',
    label: '错过机会',
    description: '记录看见但没有执行的场景',
    scope: '不计入实盘',
    tone: 'missed',
  },
  {
    id: 'notes',
    label: '随记',
    description: '先记下想法，不替代交易记录',
    scope: '不进入交易统计',
    tone: 'neutral',
  },
];

export const shortcutRows = [
  { label: '打开命令面板', windows: 'Ctrl K', macos: 'Command K' },
  { label: '记录一笔交易', windows: 'N', macos: 'N' },
  { label: '进入下一条复盘', windows: 'J', macos: 'J' },
];

export const maintenanceOptions = [
  {
    id: 'backup',
    label: '完整备份',
    description: '交易、正文、截图与设置的完整副本',
    action: '导出 .journal.zip',
  },
  {
    id: 'json',
    label: 'JSON 数据副本',
    description: '结构化数据，不包含个人资料与快捷键',
    action: '下载 JSON',
  },
  {
    id: 'import',
    label: '导入与迁移',
    description: '导入 CSV、Notion 或现有 Atlas 数据',
    action: '选择来源',
  },
  {
    id: 'recovery',
    label: '恢复数据库',
    description: '从完整备份恢复数据与附件',
    action: '选择 .journal.zip',
  },
];

export const searchIndex = [
  { id: 'orientation', title: '认识 Atlas', description: '理解交易日志与复盘工作台的边界' },
  { id: 'record-first-trade', title: '记录第一笔交易', description: '先捕捉交易事实，再补充详情' },
  { id: 'enrich-trade', title: '补充详情', description: '正文、截图、属性和来源关系' },
  { id: 'complete-review', title: '完成复盘', description: '事实、判断、改进动作与复盘状态' },
  { id: 'case-library', title: '沉淀案例', description: '让高价值交易形成可追溯案例' },
  { id: 'read-statistics', title: '读懂统计', description: '先选择范围，再解释指标口径' },
  { id: 'review-loop', title: '周复盘与随机复盘', description: '模式总结与旧交易抽查' },
  { id: 'special-records', title: '其它记录方式', description: '实盘、模拟盘、错过机会、随记' },
  { id: 'risk-maintenance', title: '风险与维护', description: '风险证据、备份、导入、恢复与回收站' },
  { id: 'settings-efficiency', title: '设置与桌面效率', description: '快捷键、策略、标签、显示与更新' },
];
