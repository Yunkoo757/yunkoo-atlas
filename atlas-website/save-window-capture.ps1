param([Parameter(Mandatory=$true)][string]$OutputPath)
Add-Type -AssemblyName System.Windows.Forms
$atlasClipboardImage = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $atlasClipboardImage) { throw 'No captured window image in clipboard' }
$atlasClipboardImage.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "$($atlasClipboardImage.Width) x $($atlasClipboardImage.Height)"
$atlasClipboardImage.Dispose()
