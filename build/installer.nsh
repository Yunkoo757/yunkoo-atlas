; 使用现代中文 UI 字体，避免 MUI 回退到宋体后产生细碎、发虚的笔画。
!ifndef MUI_FONT
  !define MUI_FONT "Microsoft YaHei UI"
!endif
!ifndef MUI_FONT_SIZE
  !define MUI_FONT_SIZE 9
!endif

; High-DPI: 让控件按当前显示器 DPI 原生布局，避免 Windows 对整窗位图缩放。
; electron-builder 会自动 include build/installer.nsh
!macro customHeader
  ManifestDPIAware true
  ManifestDPIAwareness PerMonitorV2
!macroend
