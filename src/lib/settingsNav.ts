import { Keyboard, SlidersHorizontal, HardDriveDownload, Settings2, UserCircle, Tag, Shapes, Download, FileText, Shield } from '@/icons/appIcons'

export const SETTINGS_NAV = [
  { to: '/settings/profile', label: '资料', icon: UserCircle },
  { to: '/settings/shortcuts', label: '快捷键', icon: Keyboard },
  { to: '/settings/strategies', label: '策略', icon: Settings2 },
  { to: '/settings/risk', label: '风险管理', icon: Shield },
  { to: '/settings/tags', label: '标签', icon: Tag },
  { to: '/settings/symbols', label: '品种', icon: Shapes },
  { to: '/settings/review-templates', label: '复盘起稿', icon: FileText },
  { to: '/settings/display', label: '显示', icon: SlidersHorizontal },
  { to: '/settings/data', label: '数据', icon: HardDriveDownload },
  { to: '/settings/updates', label: '更新', icon: Download },
] as const
