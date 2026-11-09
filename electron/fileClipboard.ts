import { spawn } from 'node:child_process'

/** 只调用 AppKit 剪贴板 API；不向其他应用发送 Apple Events 或键盘输入。 */
const MAC_FILE_CLIPBOARD = `
ObjC.import('Foundation'); ObjC.import('AppKit');
function run() {
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
  var items = request.files.map(function(file) {
    if (!$.NSFileManager.defaultManager.fileExistsAtPath($(file))) throw new Error('复制文件未准备完成');
    var item = $.NSPasteboardItem.alloc.init;
    item.setStringForType($.NSURL.fileURLWithPath($(file)).absoluteString, $.NSPasteboardTypeFileURL);
    return item;
  });
  var board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  if (!board.writeObjects($(items))) throw new Error('文件剪贴板写入失败');
  // AppKit 会延迟提供条目数据。退出辅助进程前逐项读回，确保最后一个附件已落入系统剪贴板。
  var copied = board.pasteboardItems;
  if (Number(copied.count) !== request.files.length) throw new Error('文件剪贴板条目不完整');
  for (var i = 0; i < request.files.length; i++) {
    var actual = ObjC.unwrap(copied.objectAtIndex(i).stringForType($.NSPasteboardTypeFileURL));
    var expected = ObjC.unwrap($.NSURL.fileURLWithPath($(request.files[i])).absoluteString);
    if (actual !== expected) throw new Error('文件剪贴板条目未准备完成');
  }
  return JSON.stringify({fileCount: Number(copied.count)});
}`

const WINDOWS_FILE_CLIPBOARD = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$atlasRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$atlasFiles = New-Object System.Collections.Specialized.StringCollection
foreach ($atlasFile in $atlasRequest.files) {
  if (!(Test-Path -LiteralPath $atlasFile -PathType Leaf)) { throw 'Clipboard file is missing' }
  [void]$atlasFiles.Add($atlasFile)
}
[System.Windows.Forms.Clipboard]::SetFileDropList($atlasFiles)
[Console]::Out.Write(('{"fileCount":' + $atlasFiles.Count + '}'))
`

/** 系统多文件复制，等价于从文件管理器复制一组文件；文件保持独立。 */
export async function writeFileClipboard(files: readonly string[]): Promise<void> {
  if (!files.length) throw new Error('没有可复制的文件')
  let executable: string
  let args: string[]
  if (process.platform === 'darwin') {
    executable = '/usr/bin/osascript'
    args = ['-l', 'JavaScript', '-e', MAC_FILE_CLIPBOARD]
  } else if (process.platform === 'win32') {
    executable = 'powershell.exe'
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(WINDOWS_FILE_CLIPBOARD, 'utf16le').toString('base64')]
  } else {
    throw new Error('当前系统不支持图文文件复制')
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let diagnosticBytes = 0
    const timeout = setTimeout(() => { child.kill(); reject(new Error('文件复制超时，请重试')) }, 15000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (part: string) => {
      output += part
      if (output.length > 16384) { child.kill(); reject(new Error('文件剪贴板响应无效，请重试')) }
    })
    // 不将系统异常栈、内部路径或正文写入产品提示或日志。
    child.stderr.on('data', (part: Buffer) => { diagnosticBytes += part.byteLength; if (diagnosticBytes > 16384) child.kill() })
    child.once('error', () => { clearTimeout(timeout); reject(new Error('无法调用系统文件剪贴板，请重试')) })
    child.once('close', (code) => {
      clearTimeout(timeout)
      try {
        if (code !== 0 || JSON.parse(output.trim()).fileCount !== files.length) throw new Error()
        resolve()
      } catch { reject(new Error('文件剪贴板写入未确认，请重试')) }
    })
    child.stdin.on('error', () => { /* close/error 统一报告失败 */ })
    child.stdin.end(JSON.stringify({ files }), 'utf8')
  })
}
