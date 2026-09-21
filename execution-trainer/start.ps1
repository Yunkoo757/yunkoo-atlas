$ErrorActionPreference = 'Stop'
$trainerRoot = $PSScriptRoot
$trainerRuntime = Join-Path $trainerRoot 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $trainerRuntime)) {
    $trainerRuntime = Join-Path $trainerRoot '../node_modules/electron/dist/electron.exe'
}
if (-not (Test-Path -LiteralPath $trainerRuntime)) { throw '请先在工具目录运行 npm install。' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $trainerRuntime -ArgumentList ('"' + $trainerRoot + '"') -WorkingDirectory $trainerRoot
