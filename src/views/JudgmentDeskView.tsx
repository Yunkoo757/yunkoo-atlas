import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { Toolbar } from '@/components/ui/Toolbar'
import { Select } from '@/components/ui/Select'
import { ModalShell } from '@/components/ui/ModalShell'
import { Menu } from '@/components/Menu'
import { ChevronLeft, ChevronRight, MoreHorizontal } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { DraftModal } from '@/components/judgment/DraftModal'
import { ImageOrder } from '@/components/judgment/ImageOrder'
import { JudgmentImage } from '@/components/judgment/JudgmentImage'
import { requestJudgmentCapture } from '@/components/judgment/captureRequest'
import { registerShortcutHandlers } from '@/shortcuts/engine'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { attemptComparison, JUDGMENT_LABELS, recordJudgment, undoJudgment } from '@/lib/judgment/assessment'
import type { Judgment, JudgmentSample, JudgmentTheme, JudgmentDeskData } from '@/lib/judgment/model'
import './JudgmentDeskView.css'
import { themeReviewQueue } from '@/lib/judgment/round'

type Observation = { sampleId?: string; imageIndex: number; comparing: boolean; otherId: string; otherImageIndex: number; activeSide: 'A' | 'B'; scrollTop: number }
// A WeakMap isolates libraries and discards observations when their snapshot is replaced.
const observations = new WeakMap<JudgmentDeskData, Observation>()

export function JudgmentDeskView() {
  const data = useStore(s => s.judgmentDesk), update = useStore(s => s.updateJudgmentDesk)
  const navigate = useNavigate()
  const theme = data.themes.find(t => t.id === data.currentThemeId) ?? data.themes[0]
  const samples = data.samples.filter(s => s.themeId === theme?.id)
  const sample = samples.find(s => s.id === data.currentSampleId) ?? samples[0]
  const index = samples.findIndex(s => s.id === sample?.id)
  const saved = observations.get(data)
  const restored = saved?.sampleId === sample?.id ? saved : undefined
  const [imageIndex, setImageIndex] = useState(restored?.imageIndex ?? 0)
  const [otherImageIndex, setOtherImageIndex] = useState(restored?.otherImageIndex ?? 0)
  const [activeSide, setActiveSide] = useState<'A' | 'B'>(restored?.activeSide ?? 'A')
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(restored?.scrollTop ?? 0)
  const [showReference, setShowReference] = useState(false)
  const [comparing, setComparing] = useState(restored?.comparing ?? false), [otherId, setOtherId] = useState(restored?.otherId ?? '')
  const [training, setTraining] = useState(false), [resultId, setResultId] = useState<string | null>(null)
  const [round, setRound] = useState<{ ids: string[]; cursor: number }>({ ids: [], cursor: 0 })
  const [completed, setCompleted] = useState(false)
  const answering = useRef(false)
  const [modal, setModal] = useState<'theme' | 'newTheme' | 'sample' | 'history' | 'remove' | 'order' | null>(null)
  const [historyPage, setHistoryPage] = useState(0)
  const other = samples.find(s => s.id === otherId && s.id !== sample?.id)
  const result = data.attempts.find(a => a.id === resultId && a.sampleId === sample?.id)
  const blind = training && !result
  const observation = useRef({ data, value: {} as Observation })
  observation.current = { data, value: { sampleId: sample?.id, imageIndex, comparing: !training && comparing, otherId, otherImageIndex, activeSide, scrollTop: scrollTop.current } }
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop.current
    return () => { observations.set(observation.current.data, { ...observation.current.value, scrollTop: scrollTop.current }) }
  }, [])
  useEffect(() => {
    if (training && sample?.id !== round.ids[round.cursor]) { setTraining(false); setCompleted(false); setResultId(null) }
  }, [training, sample?.id, round])
  useEffect(() => { setResultId(null); setHistoryPage(0); setShowReference(false) }, [sample?.id, theme?.id])
  const select = (id: string) => { answering.current = false; update(d => ({ ...d, currentThemeId: theme.id, currentSampleId: id })); setResultId(null); setImageIndex(0) }
  const move = (step: number) => {
    if (!samples.length) return
    if (training) {
      if (step < 0 || !result || completed) return
      if (round.cursor + 1 === round.ids.length) { setCompleted(true); return }
      const cursor = round.cursor + 1
      setRound(r => ({ ...r, cursor })); select(round.ids[cursor]); return
    }
    if (comparing) {
      const candidates = samples.filter(s => s.id !== sample.id), current = candidates.findIndex(s => s.id === otherId)
      if (candidates.length) { setOtherId(candidates[(current + step + candidates.length) % candidates.length].id); setOtherImageIndex(0) }
    } else select(samples[(index + step + samples.length) % samples.length].id)
  }
  const judge = (answer: Judgment) => {
    if (!sample || (training && (result || answering.current || completed))) return
    if (training) {
      answering.current = true
      const id = crypto.randomUUID()
      update(d => recordJudgment(d, sample.id, answer, id, new Date().toISOString())); setResultId(id)
    } else update(d => ({ ...d, samples: d.samples.map(s => s.id === sample.id ? { ...s, opinion: answer } : s) }))
  }
  const start = () => {
    const ids = themeReviewQueue(data.samples, theme.id)
    if (!ids.length) return
    setComparing(false); setTraining(true); setCompleted(false); setResultId(null)
    setRound({ ids, cursor: 0 }); select(ids[0])
  }
  const nextImage = (step: number, side = activeSide) => { if (comparing && side === 'B' && other) setOtherImageIndex(i => (i + step + other.images.length) % other.images.length); else if (sample) setImageIndex(i => (i + step + sample.images.length) % sample.images.length) }
  useEffect(() => registerShortcutHandlers({
    'judgment.yes': () => judge('yes'), 'judgment.no': () => judge('no'), 'judgment.uncertain': () => judge('uncertain'),
    'judgment.prev': () => move(-1), 'judgment.next': () => move(1),
    'judgment.prevImage': () => nextImage(-1), 'judgment.nextImage': () => nextImage(1),
    'judgment.exit': () => { if (training || comparing) { setTraining(false); setComparing(false) } else navigate('/list') },
  }))
  const image = sample?.images[Math.min(imageIndex, sample.images.length - 1)]
  const history = data.attempts.filter(a => a.sampleId === sample?.id).slice().reverse()
  return <div className="jd-view">
    <Toolbar title="判断台" actions={<Button variant="primary" size="sm" disabled={training} onClick={() => requestJudgmentCapture()}>收图</Button>} />
    <div className="jd-scroll" ref={scrollRef} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop }}><div className="jd-rail">
      <div className="jd-heading"><div className="jd-topic"><Select ariaLabel="当前主题" value={theme?.id ?? ''} options={data.themes.map(t => ({ value: t.id, label: t.title }))} onValueChange={id => {
        setTraining(false); setComparing(false); setImageIndex(0); update(d => ({ ...d, currentThemeId: id, currentSampleId: d.samples.find(s => s.themeId === id)?.id ?? null }))
      }} placeholder="选择主题" />{theme && !blind && <Button onClick={() => setModal('theme')}>当前口径</Button>}</div>
        <Menu align="right" trigger={<Button aria-label="主题选项"><MoreHorizontal size={ICON_MD} /></Button>} options={[{ value: 'newTheme', label: '新建主题' }]} onSelect={() => setModal('newTheme')} />
      </div>
      {!sample ? <div className="jd-empty"><h2>{theme ? '从一组有疑问的图开始' : '新建一个判断主题'}</h2><p>{theme ? '收图上传或粘贴，也可在案例、日志图片上右键收录。' : '新建一个主题，再收录你想反复对照的图。'}</p></div> : <>
        <div className="jd-heading jd-sample-heading"><div className="jd-wrap jd-title-source"><h2 title={!blind ? sample.title : undefined}>{training ? '主题复盘' : sample.title || `素材 ${index + 1}`}</h2>{!blind && <SourceLink sourceTradeId={image?.sourceTradeId} />}</div>
          <div className="jd-row">{training ? <Button onClick={() => { setTraining(false); setResultId(null) }}>结束复盘</Button> : <><Button disabled={samples.length < 2} onClick={() => { setComparing(v => !v); setActiveSide('A'); setOtherImageIndex(0); setOtherId(samples.find(s => s.id !== sample.id)?.id ?? '') }}>{comparing ? '结束对照' : '对照'}</Button><Button title="随机复盘当前主题，每组素材一次" onClick={start}>随机复盘</Button></>}
          {!training && <Menu align="right" trigger={<Button aria-label="素材选项"><MoreHorizontal size={ICON_MD} /></Button>} options={[
            { value: 'sample', label: '备注与参考判断' },
            ...(sample.images.length > 1 ? [{ value: 'order', label: '调整图片顺序' }] : []),
            { value: 'history', label: '复盘历史' }, { value: 'remove', label: '移除素材', danger: true },
          ]} onSelect={value => { if (value === 'sample' || value === 'order' || value === 'history' || value === 'remove') setModal(value) }} />}</div>
        </div>
        <div className={`jd-canvas${comparing ? ' jd-compare' : ''}`}>
          <section className="jd-panel" onPointerDown={() => setActiveSide('A')} onFocusCapture={() => setActiveSide('A')}>
            {comparing && <span className="jd-compare-label jd-muted">A · 固定当前素材{activeSide === 'A' ? ' · 键盘翻图' : ''}</span>}
            {image && <JudgmentImage key={`${sample.id}:${image.assetId}`} assetId={image.assetId} group={sample.images.map(i => i.assetId)} sourceTradeId={blind ? null : image.sourceTradeId} />}
            <ImageNavigation index={imageIndex} count={sample.images.length} onMove={step => nextImage(step, 'A')} />
          </section>
          {comparing && other && <CompareSample sample={other} candidates={samples.filter(s => s.id !== sample.id)} index={otherImageIndex} active={activeSide === 'B'} onActivate={() => setActiveSide('B')} onMove={step => nextImage(step, 'B')} onSelect={id => { setOtherId(id); setOtherImageIndex(0) }} />}
        </div>
        <div className="jd-heading">
          <div className="jd-row" role="group" aria-label="我的判断">{(['yes', 'no', 'uncertain'] as const).map(value => <OpinionButton key={value} value={value} selected={!blind && sample.opinion === value} disabled={training && !!result} onClick={() => judge(value)} />)}</div>
          <div className="jd-row"><Button disabled={training} aria-label={comparing ? '上一个对照' : '上一个素材'} onClick={() => move(-1)}><ChevronLeft size={ICON_MD} /></Button><span className="jd-muted">{training ? `复盘 ${round.cursor + 1} / ${round.ids.length}` : comparing ? '对照' : `素材 ${index + 1} / ${samples.length}`}</span><Button disabled={training && !result} aria-label={training && round.cursor + 1 === round.ids.length ? '完成本轮' : comparing ? '下一个对照' : '下一个素材'} onClick={() => move(1)}><ChevronRight size={ICON_MD} /></Button></div>
        </div>
        {result && <div className="jd-result" role="status"><span>{attemptComparison(result)}{result.previous ? ` · 上次：${JUDGMENT_LABELS[result.previous]}` : ''}{result.reference && !result.reference.needsReview ? ` · 当时参考：${JUDGMENT_LABELS[result.reference.answer]}` : ''}</span><Button onClick={() => { update(d => undoJudgment(d, result.id)); answering.current = false; setResultId(null) }}>撤销本次判断</Button></div>}
        {!blind && sample.reference && <Button className="jd-reference" aria-expanded={showReference} onClick={() => setShowReference(value => !value)}>参考：{JUDGMENT_LABELS[sample.reference.answer]}{sample.reference.needsReview ? ' · 待确认' : ''}</Button>}
        {!blind && (sample.note || sample.reference?.reason) && !sample.reference && <Button className="jd-reference" aria-expanded={showReference} onClick={() => setShowReference(value => !value)}>查看观察备注</Button>}
        {!blind && showReference && <div className="jd-reference-details">{sample.note && <p className="jd-prose">{sample.note}</p>}{sample.reference?.reason && <p className="jd-prose">{sample.reference.reason}</p>}{!sample.note && !sample.reference?.reason && <p className="jd-muted">尚未填写依据</p>}<Button size="sm" onClick={() => setModal('sample')}>编辑备注与参考判断</Button></div>}
      </>}
    </div></div>
    {training && completed && <ModalShell title="本轮复盘完成" description={`已复盘当前主题的 ${round.ids.length} 组素材。`} onClose={() => { setTraining(false); setCompleted(false); setResultId(null) }} footer={<><Button onClick={() => { setTraining(false); setCompleted(false); setResultId(null) }}>返回主题</Button><Button variant="primary" onClick={start}>再来一轮</Button></>} />}
    {(modal === 'theme' || modal === 'newTheme') && <ThemeEditor key={modal === 'newTheme' ? 'new' : theme?.id} theme={modal === 'newTheme' ? undefined : theme} onClose={() => setModal(null)} />}
    {modal === 'sample' && sample && <SampleEditor sample={sample} onClose={() => setModal(null)} />}
    {modal === 'order' && sample && <ImageOrderEditor sample={sample} onClose={() => { setModal(null); setImageIndex(0) }} />}
    {modal === 'history' && sample && <ModalShell title="复盘历史" onClose={() => setModal(null)}><div className="jd-fields">
      {!history.length && <p className="jd-muted">暂无复盘记录</p>}
      {history.slice(historyPage * 10, (historyPage + 1) * 10).map(a => <article key={a.id} className="jd-history"><div>{new Date(a.at).toLocaleString()} · {JUDGMENT_LABELS[a.answer]}</div><p className="jd-muted">{attemptComparison(a)}</p><details><summary>查看当时依据</summary><p className="jd-prose">{a.understanding || '当时尚未填写当前口径'}</p><p>{a.reference ? `参考：${JUDGMENT_LABELS[a.reference.answer]}${a.reference.needsReview ? '（待确认，未用于比较）' : ''}` : '当时没有参考判断'}</p>{a.reference?.reason && <p className="jd-prose">{a.reference.reason}</p>}</details></article>)}
      {history.length > 10 && <div className="jd-row"><Button disabled={!historyPage} onClick={() => setHistoryPage(p => p - 1)}>上一页</Button><Button disabled={(historyPage + 1) * 10 >= history.length} onClick={() => setHistoryPage(p => p + 1)}>下一页</Button></div>}
    </div></ModalShell>}
    {modal === 'remove' && sample && <ModalShell title="移除这组判断素材？" description="同时移除它的重判记录。交易、案例及其他素材引用的原图会保留。" onClose={() => setModal(null)} footer={<><Button onClick={() => setModal(null)}>取消</Button><Button variant="danger-solid" onClick={() => { update(d => ({ ...d, samples: d.samples.filter(s => s.id !== sample.id), attempts: d.attempts.filter(a => a.sampleId !== sample.id), currentSampleId: null })); setModal(null); setTraining(false); setComparing(false) }}>移除</Button></>} />}
  </div>
}
function OpinionButton({ value, selected, disabled, onClick }: { value: Judgment; selected: boolean; disabled: boolean; onClick: () => void }) {
  const hint = useShortcutHint(`judgment.${value}`, JUDGMENT_LABELS[value])
  return <Button variant="bordered" className={selected ? 'jd-opinion-selected' : ''} aria-pressed={selected} disabled={disabled} title={hint.ariaLabel} onClick={onClick}>{JUDGMENT_LABELS[value]}</Button>
}
function ImageNavigation({ index, count, onMove }: { index: number; count: number; onMove: (step: number) => void }) {
  const previous = useShortcutHint('judgment.prevImage', '上一张图'), next = useShortcutHint('judgment.nextImage', '下一张图')
  return <div className={`jd-image-nav${count === 1 ? ' is-single' : ''}`} aria-hidden={count === 1}><Button size="sm" disabled={count < 2} aria-label="上一张图" title={previous.ariaLabel} onClick={() => onMove(-1)}><ChevronLeft size={ICON_MD} /></Button><span>图 {index + 1} / {count}</span><Button size="sm" disabled={count < 2} aria-label="下一张图" title={next.ariaLabel} onClick={() => onMove(1)}><ChevronRight size={ICON_MD} /></Button></div>
}
function CompareSample({ sample, candidates, onSelect, index, active, onActivate, onMove }: { sample: JudgmentSample; candidates: JudgmentSample[]; onSelect: (id: string) => void; index: number; active: boolean; onActivate: () => void; onMove: (step: number) => void }) {
  const image = sample.images[Math.min(index, sample.images.length - 1)]
  return <section className="jd-panel" onPointerDown={onActivate} onFocusCapture={onActivate}><Select ariaLabel="对照素材 B" value={sample.id} options={candidates.map((s, i) => ({ value: s.id, label: `B · ${s.title || `素材 ${i + 1}`}${active ? ' · 键盘翻图' : ''}` }))} onValueChange={onSelect} /><JudgmentImage key={image.assetId} assetId={image.assetId} group={sample.images.map(i => i.assetId)} sourceTradeId={image.sourceTradeId} /><ImageNavigation index={index} count={sample.images.length} onMove={onMove} /><span className="jd-muted">{sample.opinion ? JUDGMENT_LABELS[sample.opinion] : '还没有判断'}</span></section>
}
function SourceLink({ sourceTradeId }: { sourceTradeId?: string | null }) {
  const trades = useStore(s => s.trades), navigate = useNavigate()
  if (!sourceTradeId) return null
  const trade = trades.find(t => t.id === sourceTradeId && !t.deletedAt)
  if (!trade) return <span className="jd-muted jd-source-link">来源已移除</span>
  return <Button className="jd-source-link" size="sm" title={`${trade.ref} · ${trade.symbol}`} onClick={() => navigate(`/trade/${encodeURIComponent(trade.id)}`, { state: { from: { pathname: '/judgment-desk' } } })}>{trade.tradeKind === 'case' ? '原案例' : '原日志'} · {trade.ref}</Button>
}
function ThemeEditor({ theme, onClose }: { theme?: JudgmentTheme; onClose: () => void }) {
  const update = useStore(s => s.updateJudgmentDesk), samples = useStore(s => s.judgmentDesk.samples)
  const [title, setTitle] = useState(theme?.title ?? ''), [note, setNote] = useState(theme?.understanding ?? '')
  const [changed, setChanged] = useState(false), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState('')
  const titleInput = useRef<HTMLInputElement>(null)
  const referenced = samples.filter(s => s.themeId === theme?.id && s.reference)
  return <DraftModal dirty={title !== (theme?.title ?? '') || note !== (theme?.understanding ?? '') || (changed && selected.length > 0)} title={theme ? '当前口径' : '新建主题'} onClose={onClose} footer={<><Button variant="primary" onClick={() => {
    if (!title.trim()) { setError('请输入主题名称'); titleInput.current?.focus(); return }
    const id = theme?.id ?? crypto.randomUUID()
    update(d => ({ ...d, themes: theme ? d.themes.map(t => t.id === id ? { ...t, title: title.trim(), understanding: note } : t) : [...d.themes, { id, title: title.trim(), understanding: note }],
      samples: changed ? d.samples.map(s => selected.includes(s.id) && s.reference ? { ...s, reference: { ...s.reference, needsReview: true } } : s) : d.samples,
      currentThemeId: id, currentSampleId: theme ? d.currentSampleId : null,
    })); onClose()
  }}>保存</Button></>}><div className="jd-fields">
    <label className="jd-field">主题名称<input ref={titleInput} value={title} onChange={e => { setTitle(e.target.value); setError('') }} placeholder="例如：4H 决策POI" aria-invalid={!!error} aria-describedby={error ? 'jd-theme-title-error' : undefined} /></label>
    {error && <p id="jd-theme-title-error" className="jd-error" role="alert">{error}</p>}
    <label className="jd-field">当前口径（可选）<textarea rows={6} value={note} onChange={e => setNote(e.target.value)} placeholder="什么算、什么不算、还有哪里没确定。" /></label>
    {!!referenced.length && <label className="jd-check"><input type="checkbox" checked={changed} onChange={e => setChanged(e.target.checked)} />判定口径有变化</label>}
    {changed && <><p className="jd-muted">选择需要重新确认参考判断的素材。过去的记录保留当时依据。</p><Button onClick={() => setSelected(referenced.map(s => s.id))}>全选</Button>{referenced.map((s, i) => <label className="jd-check" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(old => e.target.checked ? [...old, s.id] : old.filter(id => id !== s.id))} />{s.title || `素材 ${i + 1}`}</label>)}</>}
  </div></DraftModal>
}
function ImageOrderEditor({ sample, onClose }: { sample: JudgmentSample; onClose: () => void }) {
  const update = useStore(s => s.updateJudgmentDesk)
  const [images, setImages] = useState(sample.images)
  return <ModalShell title="图片顺序" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={() => {
    update(d => ({ ...d, samples: d.samples.map(s => s.id === sample.id ? { ...s, images } : s) })); onClose()
  }}>保存</Button></>}><ImageOrder images={images} onChange={setImages} /></ModalShell>
}
function SampleEditor({ sample, onClose }: { sample: JudgmentSample; onClose: () => void }) {
  const update = useStore(s => s.updateJudgmentDesk)
  const [title, setTitle] = useState(sample.title), [note, setNote] = useState(sample.note)
  const [reference, setReference] = useState(sample.reference?.answer ?? ''), [reason, setReason] = useState(sample.reference?.reason ?? '')
  const [confirm, setConfirm] = useState(false)
  return <DraftModal dirty={title !== sample.title || note !== sample.note || reference !== (sample.reference?.answer ?? '') || reason !== (sample.reference?.reason ?? '') || confirm} title="备注与参考判断" onClose={onClose} footer={<><Button variant="primary" onClick={() => {
    const changed = reference !== (sample.reference?.answer ?? '') || reason !== (sample.reference?.reason ?? '')
    update(d => ({ ...d, samples: d.samples.map(s => s.id !== sample.id ? s : { ...s, title: title.trim(), note,
      reference: reference === 'yes' || reference === 'no' ? { answer: reference, reason, confirmedAt: changed || confirm || !s.reference ? new Date().toISOString() : s.reference.confirmedAt, needsReview: confirm ? false : s.reference?.needsReview ?? false } : null,
    }) })); onClose()
  }}>保存</Button></>}><div className="jd-fields">
    <label className="jd-field">素材名称<input value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label className="jd-field">这次看到了什么<textarea rows={4} value={note} onChange={e => setNote(e.target.value)} /></label>
    <div className="jd-field"><span>参考判断（由你确定）</span><Select ariaLabel="参考判断" value={reference} onValueChange={setReference} options={[{ value: '', label: '暂不设置' }, { value: 'yes', label: '是' }, { value: 'no', label: '否' }]} /></div>
    {!!reference && <label className="jd-field">依据（可选）<textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>}
    {sample.reference?.needsReview && !!reference && <label className="jd-check"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />已按当前口径重新确认</label>}
  </div></DraftModal>
}
