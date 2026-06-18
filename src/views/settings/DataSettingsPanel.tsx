import { DataIOContent } from '@/components/DataIOContent'

export function DataSettingsPanel() {
  return (
    <div className="settings-page data-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">数据</h1>
        <p className="settings-page-desc">导入、导出与备份本地交易库。</p>
      </div>
      <DataIOContent />
    </div>
  )
}
