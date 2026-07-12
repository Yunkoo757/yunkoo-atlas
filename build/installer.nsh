; High-DPI: 避免安装向导被 Windows 位图拉伸发糊
; electron-builder 会自动 include build/installer.nsh
!macro customHeader
  ManifestDPIAware true
  ManifestDPIAwareness PerMonitorV2
!macroend
