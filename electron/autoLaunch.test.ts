import { strict as assert } from 'node:assert'
import { readAutoLaunchState, updateAutoLaunchState } from './autoLaunch'

function createApp(initial = false) {
  let enabled = initial
  return {
    app: {
      getLoginItemSettings: () => ({ openAtLogin: enabled }),
      setLoginItemSettings: (settings: { openAtLogin?: boolean }) => {
        enabled = settings.openAtLogin === true
      },
    },
    getEnabled: () => enabled,
  }
}

export function testAutoLaunchReadsTheOperatingSystemAsSourceOfTruth(): void {
  const fixture = createApp(true)
  assert.deepEqual(readAutoLaunchState(fixture.app, 'win32'), {
    supported: true,
    enabled: true,
  })
  assert.deepEqual(readAutoLaunchState(fixture.app, 'darwin'), {
    supported: true,
    enabled: true,
  })
}

export function testAutoLaunchWritesThenVerifiesTheOperatingSystemState(): void {
  const fixture = createApp(false)
  const result = updateAutoLaunchState(fixture.app, 'win32', true)
  assert.equal(fixture.getEnabled(), true)
  assert.deepEqual(result, { supported: true, enabled: true })
}

export function testAutoLaunchRejectsUnsupportedPlatformsAndInvalidInput(): void {
  const fixture = createApp(true)
  assert.equal(readAutoLaunchState(fixture.app, 'linux').supported, false)
  const invalid = updateAutoLaunchState(fixture.app, 'win32', 'true')
  assert.equal(invalid.enabled, true)
  assert.equal(invalid.error, '开机启动设置无效')
  assert.equal(fixture.getEnabled(), true)
}

export function testAutoLaunchDoesNotClaimSuccessWhenTheSystemIgnoresTheWrite(): void {
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: () => {},
  }
  const result = updateAutoLaunchState(app, 'darwin', true)
  assert.equal(result.enabled, false)
  assert.equal(result.error, '系统未能应用开机启动设置')
}
