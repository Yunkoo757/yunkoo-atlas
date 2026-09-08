param([Parameter(Mandatory=$true)][string]$OutputPath)
# Read the application's own rendered window; do not composite desktop cursors or overlays.
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AtlasWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
[void][AtlasWindowCapture]::SetProcessDpiAwarenessContext([IntPtr](-4))
$atlasTargets = @(Get-Process | Where-Object { $_.MainWindowTitle -eq 'Trader Atlas' -and $_.Path -eq 'C:\Program Files\Trader Atlas\Trader Atlas.exe' })
if ($atlasTargets.Count -ne 1) { throw 'Expected exactly one running installed Trader Atlas window.' }
$atlasRect = New-Object AtlasWindowCapture+Rect
if (-not [AtlasWindowCapture]::GetWindowRect($atlasTargets[0].MainWindowHandle,[ref]$atlasRect)) { throw 'Cannot read window bounds.' }
$atlasBitmap = New-Object System.Drawing.Bitmap(($atlasRect.Right-$atlasRect.Left),($atlasRect.Bottom-$atlasRect.Top))
$atlasGraphics = [System.Drawing.Graphics]::FromImage($atlasBitmap)
$atlasDC = $atlasGraphics.GetHdc()
try { $atlasCaptured = [AtlasWindowCapture]::PrintWindow($atlasTargets[0].MainWindowHandle,$atlasDC,2) }
finally { $atlasGraphics.ReleaseHdc($atlasDC) }
try {
 if (-not $atlasCaptured) { throw 'Window capture failed.' }
 $atlasBitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
 Write-Output "$($atlasBitmap.Width) x $($atlasBitmap.Height) PNG: $OutputPath"
} finally { $atlasGraphics.Dispose(); $atlasBitmap.Dispose() }
