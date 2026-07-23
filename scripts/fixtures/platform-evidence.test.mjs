import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parseDiskutilFileSystem } from '../file-system-type.mjs'

test('附件生命周期平台门运行真实 Electron 测试并输出可追溯报告', () => {
  const runner = fs.readFileSync('scripts/run-asset-lifecycle-platform.mjs', 'utf8')
  assert.match(runner, /electron\/library\/assetGc\.test\.ts/)
  assert.match(runner, /electron\/library\/assetInventory\.test\.ts/)
  assert.match(runner, /gitTree/)
  assert.match(runner, /sourceFingerprint/)
  assert.match(runner, /sourceIdentity/)
  assert.match(runner, /asset-lifecycle-/)
})

test('macOS 文件系统类型从 diskutil plist 读取并拒绝路径字符', () => {
  assert.equal(parseDiskutilFileSystem(`
    <plist><dict>
      <key>FilesystemName</key><string>APFS</string>
      <key>FilesystemType</key><string>apfs</string>
    </dict></plist>
  `), 'APFS')
  assert.throws(() => parseDiskutilFileSystem(`
    <plist><dict><key>FilesystemName</key><string>/</string></dict></plist>
  `), /无法识别安全的文件系统类型/)
  assert.throws(() => parseDiskutilFileSystem('<plist><dict></dict></plist>'), /缺少/)
})
