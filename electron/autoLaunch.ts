import type { AutoLaunchState } from '../src/types/journalBridge'

type AutoLaunchApp = {
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

function unavailableState(): AutoLaunchState {
  return {
    supported: false,
    enabled: false,
    error: '当前运行环境不支持开机自动启动',
  }
}

function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

export function readAutoLaunchState(
  targetApp: AutoLaunchApp,
  platform: NodeJS.Platform,
): AutoLaunchState {
  if (!isSupportedPlatform(platform)) return unavailableState()
  try {
    return {
      supported: true,
      enabled: targetApp.getLoginItemSettings().openAtLogin,
    }
  } catch {
    return {
      supported: true,
      enabled: false,
      error: '无法读取系统开机启动状态',
    }
  }
}

export function updateAutoLaunchState(
  targetApp: AutoLaunchApp,
  platform: NodeJS.Platform,
  enabled: unknown,
): AutoLaunchState {
  if (!isSupportedPlatform(platform)) return unavailableState()
  if (typeof enabled !== 'boolean') {
    return {
      ...readAutoLaunchState(targetApp, platform),
      error: '开机启动设置无效',
    }
  }
  try {
    targetApp.setLoginItemSettings({ openAtLogin: enabled })
    const state = readAutoLaunchState(targetApp, platform)
    if (state.error) return state
    if (state.enabled !== enabled) {
      return {
        ...state,
        error: '系统未能应用开机启动设置',
      }
    }
    return state
  } catch {
    return {
      ...readAutoLaunchState(targetApp, platform),
      error: '无法修改系统开机启动设置',
    }
  }
}
