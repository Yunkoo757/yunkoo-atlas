import { execFileSync } from 'node:child_process'
import path from 'node:path'

function normalizeFileSystemLabel(raw) {
  const label = raw.trim().toUpperCase()
  if (!/^[A-Z0-9._-]+$/.test(label)) {
    throw new Error(`无法识别安全的文件系统类型：${JSON.stringify(raw)}`)
  }
  return label
}

export function parseDiskutilFileSystem(plist) {
  for (const key of ['FilesystemName', 'FilesystemType']) {
    const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))
    if (match) return normalizeFileSystemLabel(match[1])
  }
  throw new Error('diskutil plist 缺少 FilesystemName/FilesystemType')
}

export function parseDfDevice(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error('df 输出缺少文件系统记录')
  const device = lines.at(-1).trim().split(/\s+/)[0]
  if (!/^\/dev\/[A-Za-z0-9._-]+$/.test(device)) {
    throw new Error(`df 返回了不安全的设备名：${JSON.stringify(device)}`)
  }
  return device
}

export function detectFileSystem(directory, platform = process.platform) {
  if (platform === 'win32') {
    const driveLetter = path.parse(path.resolve(directory)).root.slice(0, 1)
    return normalizeFileSystemLabel(execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Volume -DriveLetter '${driveLetter}').FileSystem`],
      { encoding: 'utf8' },
    ))
  }
  if (platform === 'darwin') {
    const device = parseDfDevice(execFileSync('df', ['-P', directory], { encoding: 'utf8' }))
    const plist = execFileSync('diskutil', ['info', '-plist', device], { encoding: 'utf8' })
    return parseDiskutilFileSystem(plist)
  }
  return normalizeFileSystemLabel(
    execFileSync('stat', ['-f', '-c', '%T', directory], { encoding: 'utf8' }),
  )
}
