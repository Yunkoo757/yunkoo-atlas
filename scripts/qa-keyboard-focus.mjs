import { errors } from 'playwright'

export async function receivesKeyboardFocus(control) {
  try {
    await control.and(control.page().locator(':focus')).waitFor({ state: 'attached', timeout: 2_000 })
    return true
  } catch (error) {
    if (error instanceof errors.TimeoutError) return false
    throw error
  }
}
