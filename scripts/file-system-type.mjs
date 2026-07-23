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
    const plist = execFileSync('diskutil', ['info', '-plist', directory], { encoding: 'utf8' })
    return parseDiskutilFileSystem(plist)
  }
  return normalizeFileSystemLabel(
    execFileSync('stat', ['-f', '-c', '%T', directory], { encoding: 'utf8' }),
  )
}
