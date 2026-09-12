import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ModalShell } from '@/components/ui/ModalShell'
import { Toolbar } from '@/components/ui/Toolbar'
import { Menu } from '@/components/Menu'
import { useStore } from '@/store/useStore'
import { useSaveStatus } from '@/store/saveStatus'
import { emptyComposerData, BUILTIN_RULES, type ComposerData } from '@/lib/reviewComposer/model'
import { engine, normalizeState, readState, defaultState, generate, randomState, documentFor, downloadFile } from '@/lib/reviewComposer/service'
import type { ComposerState } from '@/lib/reviewComposer/engine.js'
import options from '@/lib/reviewComposer/options.json'
import { ComposerRulesPanel } from './settings/ComposerRulesPanel'
import './ReviewComposerView.css'

const steps = ['案例与背景','位置与衔接','进场执行','管理与结果','补充信息']
export function ReviewComposerView() {
  const stored=useStore(s=>s.reviewComposer)
  const data=useMemo(()=>stored ?? emptyComposerData(),[stored])
  const rules=data.activeRules ?? BUILTIN_RULES
  const [step,setStep]=useState('0')
  const [modal,setModal]=useState<'rules'|'trace'|null>(null)
  const [status,setStatus]=useState('')
  const fileRef=useRef<HTMLInputElement>(null)
  const saveStatus=useSaveStatus(s=>s.status)
  const restored=useMemo(()=>{
    try { return {state:data.draft ? readState(data.draft.state) : defaultState(rules),error:''} }
    catch(e) { return {state:defaultState(BUILTIN_RULES),error:(e as Error).message} }
  },[data.draft,rules])
  const state=restored.state
  const result=useMemo(()=>generate(state,rules),[state,rules])
  const text=data.draft?.text ?? result.text
  const stale=!!data.draft && data.draft.ruleVersion!==rules.version
  const fieldError=(key:string)=>!stale&&((key==='beText'&&state.be==='custom'&&!state.beText.trim())||(key==='targetText'&&state.target==='custom'&&!state.targetText.trim()))
  const otherWarnings=result.warnings.filter(w=>!(fieldError('beText')&&w.includes('填写已选的BE对象'))&&!(fieldError('targetText')&&w==='填写目标对象。'))
  function save(next:ComposerData){useStore.setState({reviewComposer:next})}
  function update(k:keyof ComposerState,v:string|boolean){
    const next=normalizeState({...state,[k]:v,scenario:null})
    save({...data,draft:documentFor(next,rules)})
    setStatus('')
  }
  const select=(key:keyof typeof options,label:string,disabled=false)=>{
    let choices=options[key].map(o=>({...o,disabled:(key==='entry'&&o.value==='break'&&state.trigger!=='second')||(key==='stage'&&o.value==='simple'&&state.nav==='2')||(key==='outcome'&&o.value==='miss'&&state.entry==='market')}))
    if(key==='nav')choices=choices.filter(o=>rules.allowedNavigations.includes(o.value))
    return <div className="rc-field"><span>{label}</span><Select ariaLabel={label} value={String(state[key])} options={choices} disabled={disabled} onValueChange={v=>update(key,v)}/></div>
  }
  const input=(key:'symbol'|'beText'|'targetText',label:string)=><div className="rc-field"><label htmlFor={`rc-${key}`}>{label}</label><input id={`rc-${key}`} value={state[key]} aria-invalid={fieldError(key)||undefined} aria-describedby={fieldError(key)?`rc-error-${key}`:undefined} maxLength={key==='symbol'?40:200} onChange={e=>update(key,e.target.value)}/>{fieldError(key)&&<span className="rc-error" role="alert" id={`rc-error-${key}`}>请填写{label}，或在上方改选规则建议。</span>}</div>
  const check=(key:'reference'|'retry',label:string,disabled=false)=><label className="rc-check"><input type="checkbox" checked={state[key]} disabled={disabled} onChange={e=>update(key,e.target.checked)}/>{label}</label>
  function simulate(){try{
    const next=randomState(rules,{period:data.periodLocked?state.period:undefined,includeHistorical:data.includeHistorical})
    save({...data,draft:documentFor(next,rules)});setStatus('')
    requestAnimationFrame(()=>{
      const layout=document.querySelector('.rc-layout')
      if(layout && getComputedStyle(layout).gridTemplateColumns.split(' ').length===1)
        document.querySelector('.rc-document')?.scrollIntoView({block:'start'})
    })
  }catch(e){setStatus((e as Error).message)}}
  async function importOptions(file?:File){
    if(!file)return
    const identity=useStore.getState().liveStages
    const initial=useStore.getState().reviewComposer
    try {
      if(file.size>100000)throw Error('选项文件超过 100 KB。')
      const value=JSON.parse(await file.text())
      if(value.version!==1)throw Error('选项版本不兼容，请导入原组合器导出的 JSON。')
      const next=readState(value.state)
      if(identity!==useStore.getState().liveStages)throw Error('资料库已切换，请在当前资料库重新导入。')
      if(initial!==useStore.getState().reviewComposer)throw Error('条件已变化，请重新导入。')
      save({...data,draft:documentFor(next,rules)});setStatus('选项已导入。')
    }catch(e){setStatus(e instanceof SyntaxError?'文件不是有效的 JSON，请重新选择组合器导出的选项文件。':(e as Error).message)}
  }
  const blocked=!!restored.error || (!stale && result.warnings.length>0)
  return <div className="rc-view">
    <Toolbar title="复盘组合器" actions={<div className="rc-actions">
      <Menu trigger={<Button aria-label="组合器工具">更多</Button>} options={[
        {value:'rules',label:'规则设置'},{value:'import',label:'导入选项'},{value:'export',label:'导出选项'},
        {value:'trace',label:'生成依据'},{value:'reset',label:'重置条件'},
      ]} onSelect={v=>{
        if(v==='rules'||v==='trace')setModal(v)
        if(v==='import')fileRef.current?.click()
        if(v==='export')downloadFile('复盘选项.json',JSON.stringify({version:1,state},null,2),'application/json')
        if(v==='reset'){save({...data,draft:documentFor(defaultState(rules),rules)});setStep('0');setStatus('已重置条件。')}
      }}/><Button variant="primary" onClick={simulate}>生成模拟</Button>
    </div>}/>
    <div className="rc-scroll"><div className="rc-rail">
      <SegmentedControl label="复盘步骤" role="tablist" value={step} onChange={setStep} options={steps.map((label,i)=>({value:String(i),label,controls:`rc-step-${i}`}))}/>
      <div className="rc-layout">
        <section id={`rc-step-${step}`} role="tabpanel" aria-label={steps[Number(step)]} className="rc-conditions">
          {step==='0'&&<>
            <div className="rc-row">{select('mode','用途')}<div className="rc-field"><span>案例日期</span><DatePicker ariaLabel="案例日期" value={state.date} onValueChange={v=>update('date',v)}/></div></div>
            <div className="rc-row">{input('symbol','品种')}{select('side','参与方向')}</div>
            {select('nav','参与背景')}
            {select('period','HTF / MTF / LTF')}
            <label className="rc-check"><input type="checkbox" checked={data.periodLocked} onChange={e=>save({...data,periodLocked:e.target.checked})}/>模拟时锁定周期</label>
            {['2','5'].includes(state.nav)&&select('stage','HTF 对齐阶段')}
            {select('htfLocation','HTF 位置模型')}
            {state.htfLocation==='modelC'&&<div className="rc-row">{select('htfLiquidity','POI 前结构点周期')}{select('htfReaction','市场反应')}</div>}
          </>}
          {step==='1'&&<>
            {check('reference',`添加参考 MTF${engine.periods[state.period][3]?' · '+engine.periods[state.period][3]:'（此周期不支持）'}`,state.nav==='5'||!engine.periods[state.period][3])}
            {check('retry','第一单止损，MTF 发生 ORA 后再次参与',state.nav==='5')}
            {select('alignment','执行 MTF 对齐')}{select('location','执行 MTF 的 POI / 流动性模型')}
          </>}
          {step==='2'&&<>{select('trigger','LTF 对齐信号')}{select('entry','进场方式')}{select('sl','SL 覆盖对象')}</>}
          {step==='3'&&<>
            <div className="rc-field"><span>BE 对象</span><Select ariaLabel="BE 对象" value={state.be} options={Object.entries(result.management.beChoices).map(([value,label])=>({value,label}))} onValueChange={v=>update('be',v)}/></div>
            {state.be==='custom'&&input('beText','具体 BE 对象')}
            <div className="rc-field"><span>TP 目标</span><Select ariaLabel="TP 目标" value={state.target} options={Object.entries(result.management.targetChoices).map(([value,label])=>({value,label}))} onValueChange={v=>update('target',v)}/></div>
            {state.target==='custom'&&input('targetText','具体目标与用途')}
            {select('manage','管理方式',['4','5'].includes(state.nav))}{select('outcome',state.retry?'第二单结果':'参与结果')}
          </>}
          {step==='4'&&<label className="rc-field">补充原话<textarea rows={6} maxLength={20000} value={state.extra} onChange={e=>update('extra',e.target.value)}/></label>}
          {!stale&&otherWarnings.length>0&&<div className="rc-error" role="alert">{otherWarnings.map(w=><p key={w}>{w}</p>)}<Button onClick={()=>{
            const warning=otherWarnings[0]
            setStep(/BE|目标|TP|退出/.test(warning)?'3':/导航范围|未启用/.test(warning)?'0':/第一单/.test(warning)?'1':/SL|LTF失效点/.test(warning)?'2':'1')
            requestAnimationFrame(()=>document.querySelector<HTMLElement>('.rc-conditions input, .rc-conditions [role="combobox"]')?.focus())
          }}>前往调整条件</Button></div>}
        </section>
        <section className="rc-document" aria-label="复盘正文">
          <div className="rc-document-toolbar"><span>{state.scenario?'虚构模拟':'按已知条件搭建'}</span><div className="rc-actions">
            <Button disabled={blocked||!text} onClick={async()=>{try{await navigator.clipboard.writeText(text);setStatus('已复制。')}catch{setStatus('复制失败，请选中正文后按 Ctrl+C（macOS 为 ⌘C）。')}}}>复制</Button>
          </div></div>
          {stale&&<div className="rc-notice">已保留原正文。<Button onClick={()=>save({...data,draft:documentFor(state,rules)})}>按新规则更新正文</Button></div>}
          {restored.error&&<p className="rc-error" role="alert">{restored.error} 可导出选项保留副本，再重置条件。</p>}
          <article>{text?text.split('\n\n').map((p,i)=><p key={i}>{p}</p>):<p className="rc-muted">调整条件后生成正文。</p>}</article>
        </section>
      </div>
      {(status||saveStatus==='error')&&<p role="status" className="rc-notice">{saveStatus==='error'?'保存失败，当前内容仍在；请导出选项备份并检查资料库。':status}</p>}
    </div></div>
    <input hidden ref={fileRef} type="file" accept=".json" onChange={e=>{void importOptions(e.target.files?.[0]);e.target.value=''}}/>
    {modal==='rules'&&<ModalShell title="组合器规则" onClose={()=>setModal(null)}><ComposerRulesPanel/></ModalShell>}
    {modal==='trace'&&<ModalShell title="生成依据" onClose={()=>setModal(null)}>
      <p>{data.draft?.ruleVersion??rules.version} · {state.scenario?'已检查模拟声明的事件关系，不代表真实行情满足条件。':'手动条件未经过模拟场景校验。'}</p>
      {state.scenario&&<details><summary>结构与事件详情</summary><pre className="rc-code">{JSON.stringify(state.scenario,null,2)}</pre></details>}
    </ModalShell>}
  </div>
}
