import { beginOperation, type OperationLogDetail } from './operationLogger'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function capture() {
  const records: { level: string; event: string; detail: OperationLogDetail }[] = []
  return {
    records,
    sink: (level: 'info' | 'error', event: string, detail: OperationLogDetail) => {
      records.push({ level, event, detail })
    },
  }
}

export function testOperationLoggerEmitsOneStartAndOneSuccess(): void {
  const observed = capture()
  let clock = 100
  const operation = beginOperation('archive', {
    operationId: 'operation-1',
    actionId: 'action-1',
    requestId: 'request-1',
    platform: 'test-platform',
    stage: 'prepare',
    revisionBefore: 7,
    now: () => clock,
    sink: observed.sink,
  })
  clock = 145
  assert(operation.success({ stage: 'committed', revisionAfter: 8 }), '首次成功终态必须写入')
  assert(!operation.success({ stage: 'duplicate', revisionAfter: 9 }), '重复成功终态必须被抑制')
  assert(observed.records.length === 2, '一个操作必须只有 start 和一个终态')
  assert(observed.records[0].event === 'archive:start', '归档必须先记录 start')
  const success = observed.records[1]
  assert(success.event === 'archive:success', '归档提交后必须记录 success')
  assert(success.detail.operationId === 'operation-1', '必须保留 operationId')
  assert(success.detail.actionId === 'action-1' && success.detail.requestId === 'request-1', '必须保留 actionId/requestId')
  assert(success.detail.platform === 'test-platform', '必须保留平台')
  assert(success.detail.revisionBefore === 7 && success.detail.revisionAfter === 8, '成功后才允许记录新 revision')
  assert(success.detail.durationMs === 45, '必须记录操作耗时')
}

export function testOperationLoggerFailureNeverEmitsSuccessSavedOrReleased(): void {
  const observed = capture()
  let clock = 10
  const secret = 'D:\\private\\交易正文.html'
  const operation = beginOperation('import', {
    stage: 'validate',
    now: () => clock,
    sink: observed.sink,
  })
  clock = 25
  assert(operation.failure({ code: 'archive-invalid', path: secret }, { stage: 'validate' }), '首次失败终态必须写入')
  assert(!operation.success({ stage: 'committed', revisionAfter: 1 }), '失败后不得再写成功终态')
  assert(observed.records.length === 2, '失败操作必须只有 start 和 failure')
  const serialized = JSON.stringify(observed.records)
  assert(observed.records[1].event === 'import:failure', '导入失败必须记录 failure')
  assert(observed.records[1].detail.code === 'archive-invalid', '失败必须保留稳定错误 code')
  assert(observed.records[1].detail.revisionAfter === observed.records[1].detail.revisionBefore, '失败不得报告新 revision')
  assert(!serialized.includes(secret), '结构化操作日志不得包含私密路径')
  assert(!serialized.includes('import:success'), '失败路径不得误报 success')
  assert(!serialized.includes('saved') && !serialized.includes('released'), '失败路径不得误报 saved/released')
}
