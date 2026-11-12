import { collectRetiredSnapshotAssetIds, stripRetiredSnapshotDomains } from './retiredSnapshotDomains'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testRetiredSnapshotFieldsAreDroppedWithoutChangingActiveData(): void {
  const trades = [{ id: 'retained-trade', note: '<img src="journal-asset://shared">' }]
  const original = { trades, judgmentDesk: { corrupt: true }, reviewComposer: 'legacy-invalid-state', profile: { displayName: '隔离样例' } }
  const stripped = stripRetiredSnapshotDomains(original)
  assert(!('judgmentDesk' in stripped) && !('reviewComposer' in stripped), '退役状态必须从输出中完全剥离')
  assert(stripped.trades === trades && stripped.profile === original.profile, '现行业务数据必须保持原引用和值')
  assert('judgmentDesk' in original && 'reviewComposer' in original, '纯清理不得改写输入对象')
}

export function testRetiredAssetIdsUseOnlyKnownSafeLegacyImagePaths(): void {
  const ids = collectRetiredSnapshotAssetIds({
    judgmentDesk: {
      samples: [{ images: [{ assetId: 'shared' }, { assetId: '../unsafe' }, null, { assetId: 'sample-only' }] }, null],
      attempts: [{ evidence: { images: [{ assetId: 'history-only' }, { assetId: 'shared' }] } }, { images: [{ assetId: 'wrong-attempt-path' }] }],
      unrelated: [{ assetId: 'wrong-path' }],
    },
    reviewComposer: { images: [{ assetId: 'composer-is-not-an-asset-domain' }] },
  })
  assert([...ids].sort().join() === 'history-only,sample-only,shared', '仅已知合法逐图引用可识别为退役附件')
  for (const invalid of [null, [], 'legacy', { judgmentDesk: [] }, { judgmentDesk: { samples: {}, attempts: null } }]) {
    assert(collectRetiredSnapshotAssetIds(invalid).size === 0, '无效或缺失退役状态应按空引用处理')
  }
}

export function testRetiredNavigationOverridesAreRemovedWithoutChangingActiveSettings(): void {
  const activeBinding = { key: 'x' }
  const activeItem = { id: 'keep-paper', target: { kind: 'system', id: 'paper' }, placement: 'pinned', order: 1 }
  const original = {
    shortcuts: { 'nav.list': activeBinding, 'nav.judgmentDesk': 'corrupt-old-binding', 'nav.reviewComposer': null, 'judgment.yes': null, 'future.extension': null },
    display: {
      sidebarPrimaryOrder: ['judgmentDesk', 'trades', 'reviewComposer', 'reviewSession'],
      sidebarPins: ['paper', 'judgmentDesk'],
      sidebarWorkspaceItems: [activeItem, { id: 'old-workspace', target: { kind: 'system', id: 'judgmentDesk' } }],
      workspaceMemory: { today: { pathname: '/settings/composer-rules' }, trade: { pathname: '/judgment-desk' }, case: { pathname: '/review-cases' }, reviewComposer: { pathname: '/review-composer' }, retainedExtension: { pathname: '/settings/composer-rules' } },
      privacyMode: true,
      retainedExtension: { keep: true },
    },
  }
  const before = JSON.stringify(original)
  const cleaned = stripRetiredSnapshotDomains(original)
  assert(Object.keys(cleaned.shortcuts).join() === 'nav.list,future.extension', '仅退役快捷键应移除，活跃及其他扩展保持')
  assert(cleaned.shortcuts['nav.list'] === activeBinding, '活跃快捷键应保留原引用')
  assert(cleaned.display.sidebarPrimaryOrder.join() === 'trades,reviewSession' && cleaned.display.sidebarPins.join() === 'paper', '退役导航不得继续回写')
  assert(cleaned.display.sidebarWorkspaceItems.length === 1 && cleaned.display.sidebarWorkspaceItems[0] === activeItem, '现行侧栏项目不得改写')
  assert(Object.keys(cleaned.display.workspaceMemory).join() === 'case,retainedExtension', '已知导航槽中的退役页面与设置页应移除，任意扩展不扫描')
  assert(cleaned.display.retainedExtension === original.display.retainedExtension && cleaned.display.privacyMode, '其他显示设置必须保持原样')
  assert(JSON.stringify(original) === before, '清理导航不得修改来源对象')
}
