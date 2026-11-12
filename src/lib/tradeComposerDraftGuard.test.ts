import assert from 'node:assert/strict'
import { assertTradeComposerDraftCanClose, registerTradeComposerDraftGuard } from './tradeComposerDraftGuard'

export function testDraftCloseGuardReadsCurrentStateAndReleasesOnUnmount() {
  let dirty = false
  const unregister = registerTradeComposerDraftGuard(() => dirty)
  try {
    assert.doesNotThrow(assertTradeComposerDraftCanClose)
    dirty = true
    assert.throws(assertTradeComposerDraftCanClose, /表单尚未保存/)
    dirty = false
    assert.doesNotThrow(assertTradeComposerDraftCanClose)
  } finally { unregister() }
  assert.doesNotThrow(assertTradeComposerDraftCanClose)
}

export function testOldDraftGuardCleanupCannotRemoveAReopenedComposerGuard() {
  const oldCleanup = registerTradeComposerDraftGuard(() => false)
  const currentCleanup = registerTradeComposerDraftGuard(() => true)
  try {
    oldCleanup()
    assert.throws(assertTradeComposerDraftCanClose, /表单尚未保存/)
  } finally { oldCleanup(); currentCleanup() }
  assert.doesNotThrow(assertTradeComposerDraftCanClose)
}
