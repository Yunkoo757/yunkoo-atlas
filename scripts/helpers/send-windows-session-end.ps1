param(
  [Parameter(Mandatory=$true)][int]$AtlasProcessId,
  [Parameter(Mandatory=$true)][UInt64]$WindowHandle,
  [Parameter(Mandatory=$true)][string]$ExpectedUserData,
  [Parameter(Mandatory=$true)][ValidateSet('query', 'confirmed', 'cancelled')][string]$Message
)

$ErrorActionPreference = 'Stop'
$atlasProfile = [System.IO.Path]::GetFullPath($ExpectedUserData)
$atlasTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $atlasProfile.StartsWith($atlasTemp + 'atlas-session-end-', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Session-end messages are restricted to the isolated atlas-session-end test profile.'
}
$atlasProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $AtlasProcessId"
if (-not $atlasProcess -or -not $atlasProcess.CommandLine.Contains($atlasProfile)) {
  throw 'The expected isolated main process does not own this profile.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AtlasSessionEndMessages {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wParam,
    IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@

$atlasHwnd = [IntPtr]::new([long]$WindowHandle)
$atlasOwnerId = [uint32]0
[void][AtlasSessionEndMessages]::GetWindowThreadProcessId($atlasHwnd, [ref]$atlasOwnerId)
if ($atlasOwnerId -ne $AtlasProcessId) {
  throw 'The HWND is not owned by the expected isolated main process.'
}
$atlasMessageId = if ($Message -eq 'query') { [uint32]0x11 } else { [uint32]0x16 }
$atlasConfirmed = if ($Message -eq 'confirmed') { [UIntPtr]::new(1) } else { [UIntPtr]::Zero }
$atlasResult = [UIntPtr]::Zero
$atlasSent = [AtlasSessionEndMessages]::SendMessageTimeout(
  $atlasHwnd, $atlasMessageId, $atlasConfirmed, [IntPtr]::Zero, 2, 1000, [ref]$atlasResult
)
@{
  processId = $atlasOwnerId
  message = $Message
  messageId = $atlasMessageId
  delivered = $atlasSent -ne [IntPtr]::Zero
  result = $atlasResult.ToUInt64()
  win32Error = if ($atlasSent -eq [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { 0 }
} | ConvertTo-Json -Compress
