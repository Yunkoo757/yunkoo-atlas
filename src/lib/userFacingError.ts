const CHINESE_TEXT = /[\u3400-\u9fff]/

export function userFacingErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  return CHINESE_TEXT.test(message) ? message : fallback
}
