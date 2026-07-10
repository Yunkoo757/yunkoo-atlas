import { useState } from 'react'
import { useStore } from '@/store/useStore'
import type { DisputeType } from '@/data/case'
import { Plus, Pencil, Trash2, X, Check, Shield } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import './DisputeTypesPanel.css'

function uniqueDtId(name: string, existing: DisputeType[]): string {
  const base = 'dt_' + name.toLowerCase().replace(/\s+/g, '_').slice(0, 20)
  if (!existing.some((d) => d.id === base)) return base
  let i = 2
  while (existing.some((d) => d.id === `${base}_${i}`)) i++
  return `${base}_${i}`
}

export function DisputeTypesPanel() {
  const disputeTypes = useStore((s) => s.disputeTypes)
  const addDisputeType = useStore((s) => s.addDisputeType)
  const updateDisputeType = useStore((s) => s.updateDisputeType)
  const removeDisputeType = useStore((s) => s.removeDisputeType)
  const [editing, setEditing] = useState<DisputeType | null>(null)

  const [name, setName] = useState('')
  const [options, setOptions] = useState('')
  const [positive, setPositive] = useState('')

  const startNew = () => {
    setEditing({ id: '', name: '', options: [], positiveOption: '', builtin: false })
    setName('')
    setOptions('')
    setPositive('')
  }

  const startEdit = (dt: DisputeType) => {
    setEditing(dt)
    setName(dt.name)
    setOptions(dt.options.join(', '))
    setPositive(dt.positiveOption)
  }

  const handleSave = () => {
    const opts = options.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (!name.trim() || opts.length < 2 || !positive.trim()) {
      toast('请填写完整（名称、至少2个选项、正例选项）')
      return
    }
    if (!opts.includes(positive.trim())) {
      toast('正例选项必须在选项列表中')
      return
    }
    const existingNames = disputeTypes.filter((d) => d.id !== editing!.id)
    if (existingNames.some((d) => d.name === name.trim())) {
      toast('名称重复')
      return
    }

    if (editing!.id) {
      updateDisputeType(editing!.id, { name: name.trim(), options: opts, positiveOption: positive.trim() })
      toast('纠纷类型已更新')
    } else {
      addDisputeType({
        id: uniqueDtId(name.trim(), disputeTypes),
        name: name.trim(),
        options: opts,
        positiveOption: positive.trim(),
        builtin: false,
      })
      toast('纠纷类型已创建')
    }
    setEditing(null)
  }

  return (
    <div className="settings-page dt-panel">
      <div className="settings-page-head dt-head">
        <div>
          <h1 className="settings-page-title">纠纷类型</h1>
          <p className="settings-page-desc">
            管理判例库的纠纷分类体系。内置类型不可删除，自定义类型可自由增删改。
          </p>
        </div>
        <button type="button" className="dt-add-btn" onClick={startNew}>
          <Plus size={16} />
          <span>新建类型</span>
        </button>
      </div>

      <div className="dt-list">
        {disputeTypes.map((dt) => (
          <div className="dt-row" key={dt.id}>
            <div className="dt-row-main">
              <span className="dt-row-name">{dt.name}</span>
              <span className="dt-row-meta">
                {dt.options.join(' / ')} · 正例: {dt.positiveOption}
              </span>
            </div>
            <div className="dt-row-actions">
              {dt.builtin ? (
                <span className="dt-badge">内置</span>
              ) : (
                <>
                  <Tooltip content="编辑" label={`编辑 ${dt.name}`}>
                    <button className="dt-act" aria-label={`编辑 ${dt.name}`} onClick={() => startEdit(dt)}>
                      <Pencil size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip content="删除" label={`删除 ${dt.name}`}>
                    <button
                      className="dt-act dt-act-danger"
                      aria-label={`删除 ${dt.name}`}
                      onClick={() => {
                        if (window.confirm(`删除「${dt.name}」？已有判例不受影响。`)) {
                          removeDisputeType(dt.id)
                          toast(`已删除「${dt.name}」`)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="dt-modal-overlay" onMouseDown={() => setEditing(null)}>
          <div className="dt-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dt-modal-head">
              <span>{editing.id ? '编辑纠纷类型' : '新建纠纷类型'}</span>
              <button className="dt-modal-close" onClick={() => setEditing(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="dt-modal-body">
              <label className="dt-field">
                <span>名称</span>
                <input
                  className="dt-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：4H iBOS 是否成立"
                />
              </label>
              <label className="dt-field">
                <span>裁决选项（逗号分隔，至少2个）</span>
                <input
                  className="dt-input"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="如：是, 不是"
                />
              </label>
              <label className="dt-field">
                <span>正例选项</span>
                <input
                  className="dt-input"
                  value={positive}
                  onChange={(e) => setPositive(e.target.value)}
                  placeholder={options.split(/[,，]/)[0]?.trim() || '输入正例选项'}
                />
              </label>
            </div>
            <div className="dt-modal-foot">
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="dt-btn-primary" onClick={handleSave}>
                <Check size={14} />
                <span>保存</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
