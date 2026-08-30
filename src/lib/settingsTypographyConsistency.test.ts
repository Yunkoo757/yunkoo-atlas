import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  if (!match) throw new Error(`缺少设置字体样式：${selector}`)
  return match[1] ?? ''
}

function expectRole(css: string, selector: string, declaration: string): void {
  if (!rule(css, selector).includes(declaration)) {
    throw new Error(`${selector} 必须包含 ${declaration}`)
  }
}

export function testSharedSettingsTypographyUsesCanonicalRoles(): void {
  const layout = read('src/views/settings/SettingsLayout.css')
  const profile = read('src/views/settings/ProfileSettingsPanel.css')

  expectRole(layout, '.settings-page-title', 'font-size: var(--type-page-title-size)')
  expectRole(layout, '.settings-page-desc', 'font-size: var(--type-metadata-size)')
  expectRole(layout, '.settings-page-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(layout, '.settings-section-title', 'font-size: var(--type-section-title-size)')
  expectRole(layout, '.settings-section-desc', 'font-size: var(--type-metadata-size)')
  expectRole(layout, '.settings-section-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(profile, '.profile-preview-name', 'font-size: var(--type-body-size)')
  expectRole(profile, '.profile-preview-name', 'line-height: var(--type-body-line-height)')

  if (rule(profile, '.profile-preview-name').includes('--type-page-title-size')) {
    throw new Error('个人资料预览名称不得与页面主标题同级')
  }
}

export function testSettingsDescriptionsUseMetadataWithoutFlatteningImportantValues(): void {
  const display = read('src/views/settings/DisplaySettingsPanel.css')
  const tags = read('src/views/settings/TagPresetsPanel.css')
  const data = read('src/components/DataIOContent.css')

  expectRole(display, '.display-section-head p', 'font-size: var(--type-metadata-size)')
  expectRole(display, '.display-section-head p', 'line-height: var(--type-metadata-line-height)')
  expectRole(tags, '.tag-section-desc', 'font-size: var(--type-metadata-size)')
  expectRole(tags, '.tag-section-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(data, '.dio-desc', 'font-size: var(--type-metadata-size)')
  expectRole(data, '.dio-group-desc', 'font-size: var(--type-metadata-size)')

  expectRole(data, '.storage-summary strong', 'font-size: var(--type-body-size)')
  expectRole(data, '.dio-restore-warning', 'font-size: var(--type-body-size)')
  expectRole(data, '.data-purge-summary > strong', 'font-size: var(--type-body-size)')
}
