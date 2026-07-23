import {
  beginWebOperation,
  clearWebOperationLogsForTests,
  getWebOperationLogs,
} from '@/storage/webOperationLogger'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testWebOperationLoggerHasOneStartAndOneTerminalRecord(): void {
  clearWebOperationLogsForTests()
  let clock = 10
  const operation = beginWebOperation('archive', {
    operationId: 'web-operation-1',
    actionId: 'web-action-1',
    requestId: 'web-request-1',
    stage: 'prepare',
    revisionBefore: 4,
    now: () => clock,
  })
  clock = 35
  assert(operation.success({ stage: 'committed', revisionAfter: 5 }), '首次 success 必须写入')
  assert(!operation.failure(new Error('late failure'), { stage: 'late' }), '成功后不得再写 failure')
  const logs = getWebOperationLogs()
  assert(logs.length === 2 && logs[0].event === 'archive:start' && logs[1].event === 'archive:success', '必须恰好 start→success')
  assert(logs[1].actionId === 'web-action-1' && logs[1].requestId === 'web-request-1', '必须保留 actionId/requestId')
  assert(logs[1].platform === 'web' && logs[1].durationMs === 25, '必须保留平台与耗时')
  assert(logs[1].revisionBefore === 4 && logs[1].revisionAfter === 5, '成功后才记录新 revision')
}

export function testWebOperationFailureContainsNoPayloadOrSuccessMisreport(): void {
  clearWebOperationLogsForTests()
  const secret = 'C:\\private\\复盘正文.html'
  const operation = beginWebOperation('import', { stage: 'validate', revisionBefore: 7 })
  operation.failure({ code: 'archive-invalid', path: secret }, { stage: 'validate' })
  operation.success({ stage: 'committed', revisionAfter: 8 })
  const serialized = JSON.stringify(getWebOperationLogs())
  assert(!serialized.includes(secret), 'Web 操作日志不得记录路径或原始错误对象')
  assert(!serialized.includes('import:success'), '失败路径不得误报 success')
  assert(!serialized.includes('saved') && !serialized.includes('released'), '失败路径不得误报 saved/released')
  const failure = getWebOperationLogs()[1]
  assert(failure.code === 'archive-invalid', '失败必须保留稳定错误 code')
  assert(failure.revisionAfter === failure.revisionBefore, '失败不得报告新 revision')
}
