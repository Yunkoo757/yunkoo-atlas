export const RELEASE_TRAIN_DRILLS = [
  {
    id: 'release-0',
    stop: {
      condition: '归档事务中断或发布平台失败时停止公开发布',
      scenarioIds: ['H0-B-ABORT', 'R-MAC-FAIL'],
    },
    rollback: {
      action: '回滚 writer/reader 或 workflow，同时保持 v8 完整合同与 Web 格式边界',
      scenarioIds: ['H0-B-16', 'H0-D-WEB-REJECT'],
    },
    userRecovery: {
      action: '从已验证 exact .journal.zip 恢复完整资料库',
      scenarioIds: ['H0-D-16'],
    },
  },
  {
    id: 'release-1',
    stop: {
      condition: 'stale writer 冲突或事务故障时停止 Web 发布',
      scenarioIds: ['W-SAVE-STALE', 'W-TX-ABORT-*'],
    },
    rollback: {
      action: '允许关闭 Web Locks/ownership UX，但继续由 CAS 保证正确性',
      scenarioIds: ['W-NO-LOCKS'],
    },
    userRecovery: {
      action: '冻结写入，导出本标签页副本，再加载获胜者最新版',
      scenarioIds: ['W-RECOVERY-EXPORT'],
    },
  },
  {
    id: 'release-2',
    stop: {
      condition: '路径配置损坏或退出 flush 失败时取消退出与桌面发布',
      scenarioIds: ['E-PATH-BADJSON', 'E-QUIT-FLUSH-FAIL'],
    },
    rollback: {
      action: '协调层可回滚，但已释放实例不得复用且路径继续 fail-closed',
      scenarioIds: ['E-QUIT-RELEASED', 'E-PATH-MISSING'],
    },
    userRecovery: {
      action: '保持应用可用并从已验证备份恢复；不承诺未确认内存编辑',
      scenarioIds: ['E-QUIT-BACKUP-FAIL'],
    },
  },
  {
    id: 'release-3',
    stop: {
      condition: 'dry-run 过期或附件事务失败时停止物理删除',
      scenarioIds: ['A-DRYRUN-RACE', 'A-WEB-DELETE-N'],
    },
    rollback: {
      action: '关闭 GC commit，并在数据库提交失败时从应用 trash 搬回',
      scenarioIds: ['A-ELEC-DBFAIL'],
    },
    userRecovery: {
      action: 'Web 使用操作前恢复归档；Electron 启动时幂等收敛 trash marker',
      scenarioIds: ['A-WEB-RECOVERY', 'A-ELEC-POSTDB-CRASH'],
    },
  },
]

export function evaluateReleaseTrainDrills(executedContractScenarioIds) {
  const executed = new Set(executedContractScenarioIds)
  return RELEASE_TRAIN_DRILLS.map((definition) => {
    const phases = Object.fromEntries(['stop', 'rollback', 'userRecovery'].map((phase) => {
      const expected = definition[phase].scenarioIds
      const missingScenarioIds = expected.filter((id) => !executed.has(id))
      return [phase, {
        ...definition[phase],
        status: missingScenarioIds.length === 0 ? 'pass' : 'hold',
        missingScenarioIds,
      }]
    }))
    return {
      id: definition.id,
      phases,
      status: Object.values(phases).every((phase) => phase.status === 'pass') ? 'pass' : 'hold',
    }
  })
}
