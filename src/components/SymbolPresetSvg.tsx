import type { SymbolPresetSvgId } from '@/lib/symbolIcons'

/** 立体金条 / 银条小图标，适配 14–40px */
export function SymbolPresetSvg({
  id,
  size = 12,
}: {
  id: SymbolPresetSvgId
  size?: number
}) {
  if (id === 'silver-bar') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
      >
        <path d="M3.2 6.2 8 4.2l4.8 2-4.8 2-4.8-2Z" fill="#F4F7FB" />
        <path d="M3.2 6.2 8 8.2v3.6l-4.8-2V6.2Z" fill="#A8B2C0" />
        <path d="M12.8 6.2 8 8.2v3.6l4.8-2V6.2Z" fill="#7E8896" />
        <path d="M3.2 6.2 8 8.2l4.8-2" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="0.6" />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      {/* 顶面 */}
      <path d="M3.2 6.2 8 4.2l4.8 2-4.8 2-4.8-2Z" fill="#FFE566" />
      {/* 左侧面 */}
      <path d="M3.2 6.2 8 8.2v3.6l-4.8-2V6.2Z" fill="#D4A017" />
      {/* 右侧面 */}
      <path d="M12.8 6.2 8 8.2v3.6l4.8-2V6.2Z" fill="#B8860B" />
      {/* 顶面高光 */}
      <path d="M3.2 6.2 8 8.2l4.8-2" stroke="#FFF6C8" strokeOpacity="0.55" strokeWidth="0.6" />
      {/* 条纹细节，更像金砖 */}
      <path d="M5.1 7.05 8 8.25l2.9-1.2" stroke="#F6C945" strokeOpacity="0.55" strokeWidth="0.45" />
    </svg>
  )
}
