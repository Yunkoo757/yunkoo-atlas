import { Star, Trash2, RotateCcw, Gavel } from 'lucide-react'
import type { CaseRecord, DisputeType } from '@/data/case'
import { getDisputeType } from '@/data/case'
import type { CtxItem } from '@/components/ContextMenu'

export function buildCaseCtxItems(
  rec: CaseRecord,
  disputeTypes: DisputeType[],
  actions: {
    updateCase: (id: string, patch: Partial<CaseRecord>) => void
    removeCase: (id: string) => void
  },
): CtxItem[] {
  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const finalOptions = dt ? [...dt.options, '仍无法裁决', '废弃'] : ['仍无法裁决', '废弃']

  const items: CtxItem[] = [
    { type: 'label', text: '最终裁决' },
    ...finalOptions.map(
      (opt): CtxItem => ({
        type: 'item',
        icon: <Gavel size={14} />,
        label: `设为「${opt}」`,
        onClick: () => actions.updateCase(rec.id, { finalVerdict: opt }),
      }),
    ),
    {
      type: 'item',
      icon: <Gavel size={14} />,
      label: '撤销最终裁决',
      onClick: () => actions.updateCase(rec.id, { finalVerdict: undefined }),
    },
    { type: 'divider' },
    {
      type: 'item',
      icon: <Star size={14} fill={rec.star ? 'currentColor' : 'none'} />,
      label: rec.star ? '取消典型' : '设为典型',
      onClick: () => actions.updateCase(rec.id, { star: !rec.star }),
    },
    {
      type: 'item',
      icon: <RotateCcw size={14} />,
      label: rec.recheck ? '取消复看' : '需要复看',
      onClick: () => actions.updateCase(rec.id, { recheck: !rec.recheck }),
    },
    { type: 'divider' },
    {
      type: 'item',
      icon: <Trash2 size={14} />,
      label: '删除判例',
      danger: true,
      onClick: () => actions.removeCase(rec.id),
    },
  ]

  return items
}
