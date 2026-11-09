import assert from 'node:assert/strict'
import { reduceUpdateState, type AppUpdateEvent, type AppUpdateState } from './appUpdate'

const available: AppUpdateState = { phase: 'available', currentVersion: '1.0.0', availableVersion: '1.0.1', progress: null, message: null }

export function testLateChecksCannotResetAnActiveDownload() {
  const downloading = reduceUpdateState(available, { type: 'download-started' })
  for (const event of [{ type: 'checking' }, { type: 'available', version: '1.0.2' }, { type: 'not-available' }] as AppUpdateEvent[]) {
    assert.deepEqual(reduceUpdateState(downloading, event), downloading)
  }
}

export function testDownloadedArtifactSurvivesLateProgressAndCheckFailure() {
  const downloaded = reduceUpdateState(available, { type: 'downloaded', version: '1.0.1' })
  for (const event of [{ type: 'checking' }, { type: 'not-available' }, { type: 'available', version: '1.0.2' }, { type: 'progress', percent: 50 }, { type: 'error', message: 'late check error' }] as AppUpdateEvent[]) {
    assert.deepEqual(reduceUpdateState(downloaded, event), downloaded, '下载完成后应保留待安装版本，不能回退为检查或下载中')
  }
}
