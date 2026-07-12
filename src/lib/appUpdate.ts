export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported'
  | 'credential-required'

export type AppUpdateState = {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion: string | null
  progress: number | null
  message: string | null
}

export type AppUpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'unsupported'; message: string }
  | { type: 'credential-required'; message: string }

const GITHUB_TOKEN_PATTERN = /\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/g

export function normalizeUpdateCredential(value: string): string | null {
  const token = value.trim()
  if (token.length < 20 || /\s/.test(token)) return null
  return token
}

export function redactUpdateError(message: string): string {
  return message.replace(GITHUB_TOKEN_PATTERN, '[credential]')
}

function clampProgress(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent * 10) / 10))
}

export function reduceUpdateState(
  state: AppUpdateState,
  event: AppUpdateEvent,
): AppUpdateState {
  switch (event.type) {
    case 'checking':
      return { ...state, phase: 'checking', progress: null, message: null }
    case 'available':
      return {
        ...state,
        phase: 'available',
        availableVersion: event.version,
        progress: null,
        message: null,
      }
    case 'not-available':
      return {
        ...state,
        phase: 'up-to-date',
        availableVersion: null,
        progress: null,
        message: null,
      }
    case 'progress':
      return {
        ...state,
        phase: 'downloading',
        progress: clampProgress(event.percent),
        message: null,
      }
    case 'downloaded':
      return {
        ...state,
        phase: 'downloaded',
        availableVersion: event.version,
        progress: 100,
        message: null,
      }
    case 'error':
      return { ...state, phase: 'error', progress: null, message: event.message }
    case 'unsupported':
      return { ...state, phase: 'unsupported', progress: null, message: event.message }
    case 'credential-required':
      return {
        ...state,
        phase: 'credential-required',
        progress: null,
        message: event.message,
      }
  }
}
