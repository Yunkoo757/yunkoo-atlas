import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'
import { BUILTIN_RULES, emptyComposerData } from '@/lib/reviewComposer/model'
import { checkRulePack, downloadFile } from '@/lib/reviewComposer/service'
import evidence from '@/lib/reviewComposer/evidence.json'
import { completeRulesMarkdown, completeRulesArchive } from '@/lib/reviewComposer/exportRules'
import '../ReviewComposerView.css'

export function ComposerRulesPanel({page=false}:{page?:boolean}) {
  const stored=useStore(s=>s.reviewComposer)
  const data=stored??emptyComposerData()
  const rules=data.activeRules??BUILTIN_RULES
  const fileRef=useRef<HTMLInputElement>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function importRules(file?:File){
    if(!file)return
    const identity=useStore.getState().liveStages
    const initial=useStore.getState().reviewComposer
    setBusy(true)
    try {
      if(file.size>100000)throw Error('规则包超过 100 KB，请缩减后导入。')
      const pack=checkRulePack(JSON.parse(await file.text()))
      if(identity!==useStore.getState().liveStages)throw Error('资料库已切换，请重新导入。')
      if(initial!==useStore.getState().reviewComposer)throw Error('组合器内容已变化，请重新导入。')
      if(pack.version===rules.version)throw Error('版本号相同，请为修改后的规则使用新版本号。')
      useStore.setState({reviewComposer:{...data,activeRules:pack,previousRules:rules}})
      setMessage('已启用新规则；原正文已保留，后续生成使用新规则。')
    }catch(e){setMessage(e instanceof SyntaxError?'文件不是有效的 JSON，请检查规则包格式后重新导入。':(e as Error).message)}finally{setBusy(false)}
  }
  return <div className={page?'settings-page settings-page--form':'rc-rules'}>
    {page&&<div className="settings-page-head"><h1 className="settings-page-title">组合器规则</h1></div>}
    <div className="rc-rules">
      <div><strong>{rules.name}</strong><p className="rc-muted">{rules.version}</p></div>
      <div className="rc-actions">
        <Button variant="bordered" busy={busy} onClick={()=>fileRef.current?.click()}>导入参数更新</Button>
        <Button onClick={()=>downloadFile('完整复盘规则-'+rules.version+'.md',completeRulesMarkdown(rules),'text/markdown;charset=utf-8')}>导出完整规则</Button>
        {data.previousRules&&<Button onClick={()=>{useStore.setState({reviewComposer:{...data,activeRules:data.previousRules,previousRules:rules}});setMessage('已恢复上一规则版本，现有正文保持原样。')}}>恢复上一版本</Button>}
      </div>
      <label className="rc-check"><input type="checkbox" checked={data.includeHistorical} onChange={e=>useStore.setState({reviewComposer:{...data,includeHistorical:e.target.checked}})}/>模拟包含单独 ibos · 激进观察</label>
      {message&&<p className="rc-notice" role="status">{message}</p>}
      <details><summary>规则包维护范围</summary><div className="rc-rules-help">
        <p>完整规则导出包含规则全文、当前参数、选项定义及生成/校验源码。参数 JSON 只用于更新下列可配置项。</p>
        <p>当前可更新导航范围、手动搭建的默认条件及正文表述替换。新增事件、对象关系或校验机制需要升级 Atlas 引擎。</p>
        <p>导出 JSON 后修改 version、allowedNavigations、defaults 或 phrases，再导入。phrases 使用 from / to 文本对，不执行脚本。</p>
        <p>更新先检查兼容性、默认组合及 60 个模拟样本。检查只验证声明关系与输出结构，不判断真实行情；旧正文不会自动重写。</p>
        <div className="rc-actions">
          <Button onClick={()=>downloadFile('复盘参数-'+rules.version+'.json',JSON.stringify(rules,null,2),'application/json')}>导出参数 JSON</Button>
          <Button busy={busy} onClick={async()=>{
            setBusy(true)
            try {
              const blob=await completeRulesArchive(rules)
              const url=URL.createObjectURL(blob)
              const a=document.createElement('a');a.href=url;a.download='完整复盘规则-'+rules.version+'.zip';a.click()
              setTimeout(()=>URL.revokeObjectURL(url),1000)
            } catch { setMessage('规则档案导出失败，请重试或先导出 Markdown。') }
            finally { setBusy(false) }
          }}>导出完整档案 ZIP</Button>
        </div>
      </div></details>
      <details><summary>规则依据</summary><div className="rc-rules-help">{evidence.modules.map(m=><details key={m.id}><summary>{m.title}</summary><pre className="rc-code">{m.text}</pre></details>)}</div></details>
      <input ref={fileRef} hidden type="file" accept=".json" onChange={e=>{void importRules(e.target.files?.[0]);e.target.value=''}}/>
    </div>
  </div>
}
