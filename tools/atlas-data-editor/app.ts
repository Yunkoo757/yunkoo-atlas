import { validate, migrateToPaper, resetLive, addTagPresets, assignStrategy, type EditorSnapshot } from './core'
import type { InitSqlJsStatic } from 'sql.js'
import { checkEditorLibrary, exportEditorLibrary, openEditorLibrary, readEditorAsset, type EditorSource } from './libraryFiles'
declare const initSqlJs: InitSqlJsStatic
declare global {
  interface Window {
    ATLAS_SQLITE_BYTES: string
    showDirectoryPicker(options: { mode: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
}
const $ = (id: string) => document.getElementById(id)!
const el = (tag: string, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n }
const SQL = initSqlJs({ wasmBinary: Uint8Array.from(atob(window.ATLAS_SQLITE_BYTES), c => c.charCodeAt(0)).buffer })
let source: EditorSource
let snapshot: EditorSnapshot
let history: EditorSnapshot[] = []
let group = 'live', draftDirty = false, busy = false
const selected = new Set<string>()
let urls: string[] = []
let inspectionGeneration = 0
function clearPreviewUrls() { urls.forEach(URL.revokeObjectURL); urls = [] }
const labels: Record<string,string> = { live:'实盘日志', case:'案例', paper:'模拟盘', weeklyReviews:'周复盘', quickNotes:'随记', strategies:'策略', liveStages:'实盘阶段', weeklyRiskPreparations:'每周风险准备', riskPolicyVersions:'风险规则版本', monthlyRiskLimits:'月度风险限额', riskOverrideEvents:'风险例外记录', tagPresets:'标签预置', mistakeTagPresets:'错误标签预置', assets:'附件', config:'全部数据 / 配置' }
function message(text: string) { $('message').textContent = text }
function strategySelect(label: string, placeholder: string) {
  const select = document.createElement('select'); select.setAttribute('aria-label', label)
  select.append(new Option(placeholder, ''))
  for (const strategy of snapshot.strategies) select.append(new Option(strategy.name, strategy.id))
  return select
}
function controls() { for (const id of ['check','export','undo']) ($ (id) as HTMLButtonElement).disabled = busy || !snapshot || (id === 'undo' && !history.length); ($('open') as HTMLButtonElement).disabled = busy; $('workspace').inert=busy; $('nav').inert=busy }
async function run(fn: () => Promise<void>) { if(busy)return; busy=true;controls();try{await fn()}catch(e){message(e instanceof SyntaxError ? 'JSON 格式有误，请检查引号、逗号和括号后重试。' : e instanceof DOMException && e.name==='AbortError' ? '已取消操作，当前修改仍保留。' : e instanceof Error ? e.message : String(e))}finally{busy=false;controls()} }
function ask(title:string,text:string):Promise<boolean>{ $('dialog-title').textContent=title;$('dialog-text').textContent=text;const d=$('dialog') as HTMLDialogElement;d.showModal();return new Promise(resolve=>{const done=(v:boolean)=>{d.close();resolve(v)};$('confirm').onclick=()=>done(true);$('cancel').onclick=()=>done(false);d.oncancel=e=>{e.preventDefault();done(false)}}) }
async function canLeave(){return !draftDirty || await ask('舍弃未应用的编辑？','右侧草稿尚未应用。已经应用的修改仍保留在本次会话中。')}
function dataRows(key = group): any[] {
  if (['live', 'case', 'paper'].includes(key)) return snapshot.trades.filter(trade => trade.tradeKind === key)
  if (key === 'assets') return source.assets
  if (key === 'config') return Object.keys(snapshot).map(id => ({ id, title: id, value: snapshot[id] }))
  const records = snapshot[key]
  return Array.isArray(records) ? records : []
}
function commit(next:EditorSnapshot,label:string){validate(next);history.push(snapshot);snapshot=next;draftDirty=false;selected.clear();render();message(`${label} · 待另存，可撤销（${history.length} 次修改）`)}
function render(){
  inspectionGeneration++;clearPreviewUrls();controls();$('nav').replaceChildren()
  for(const [key,label] of Object.entries(labels)){const b=el('button',label,key===group?'active':'');const n=dataRows(key).length;b.append(el('span',String(n)));b.onclick=async()=>{if(await canLeave()){group=key;draftDirty=false;selected.clear();render();message(history.length ? '当前修改尚未另存，可继续整理。' : '已打开。源资料库只读。')}};$('nav').append(b)}
  $('title').textContent=labels[group];const rows=dataRows();$('count').textContent=`${rows.length} 项 · ${history.length ? '有未导出修改' : '尚未修改'}`
  const list=el('div','','list'),toolbar=el('div','','toolbar'),search=el('input') as HTMLInputElement;search.placeholder='搜索当前分类';toolbar.append(search)
  const all=el('button','全选'),clear=el('button','取消全选'),selection=el('span','','selection-count');selection.setAttribute('role','status');toolbar.append(all,clear,selection)
  const strategyFilter = strategySelect('按策略筛选', '全部策略')
  if(['live','case','paper'].includes(group)) {
    toolbar.append(strategyFilter)
    const target = strategySelect('批量设置策略', '选择目标策略'),apply=el('button','批量设置策略') as HTMLButtonElement
    apply.disabled=true
    target.onchange=()=>{apply.disabled=!target.value||!selected.size}
    apply.onclick=()=>run(async()=>{if(!await canLeave())return;commit(assignStrategy(snapshot,selected,target.value),`已为 ${selected.size} 条记录设置策略`)})
    toolbar.append(target,apply)
    toolbar.addEventListener('selectionchange',()=>{apply.disabled=!target.value||!selected.size})
  }
  if(group==='tagPresets'||group==='mistakeTagPresets') {
    const input=document.createElement('input');input.placeholder='新增标签，多个用逗号分隔';input.setAttribute('aria-label','新增标签名称')
    const add=el('button','新增标签');const key=group
    const submit=()=>run(async()=>{if(!await canLeave())return;commit(addTagPresets(snapshot,key,input.value),'已新增标签预置')})
    add.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit()}};toolbar.append(input,add)
  }
  if(['live','case'].includes(group)){const b=el('button','迁入模拟盘');b.onclick=()=>run(async()=>{if(!selected.size)throw Error('请先选择记录');if(!await canLeave())return;if(await ask('迁入模拟盘',`将 ${selected.size} 条记录移出当前分类，保留正文、截图、标签；解除周复盘中的直接引用，冻结证据保留。`))commit(migrateToPaper(snapshot,selected),'已迁入模拟盘')});toolbar.append(b)}
  if(group==='weeklyReviews'){const b=el('button','清空周复盘');b.onclick=()=>run(async()=>{if(!await canLeave())return;if(await ask('清空周复盘',`将清空 ${snapshot.weeklyReviews.length} 篇周复盘，保留日志、模拟盘、随记及附件。`))commit({...snapshot,weeklyReviews:[]},'已清空周复盘')});toolbar.append(b)}
  if(group==='liveStages'){const b=el('button','重新开始实盘');b.onclick=()=>run(async()=>{if(!await canLeave())return;if(await ask('重新开始实盘','只需迁移实盘日志，案例无需迁移。将建立新的当前阶段，清空旧阶段、周复盘与阶段风险记录；案例保留在案例库，仅解除旧阶段关联。'))commit(resetLive(snapshot),'已重置实盘阶段')});toolbar.append(b)}
  const scroller=el('div','','rows');list.append(toolbar,scroller);const inspector=el('div','','inspector');inspector.append(el('p','选择一项查看完整数据。'));$('workspace').replaceChildren(list,inspector)
  const keyOf=(row:any,i:number)=>String(row?.id??i)
  const visibleRows = () => rows.map((row:any,i:number)=>({row,i,key:keyOf(row,i)})).filter(({row}:any)=>
    JSON.stringify(row).toLowerCase().includes(search.value.toLowerCase()) && (!strategyFilter.value || row.strategyId===strategyFilter.value))
  let headerCheck:HTMLInputElement
  function updateSelection(){
    const visible=visibleRows(),n=visible.filter(({key}:any)=>selected.has(key)).length
    all.textContent=search.value||strategyFilter.value?'全选筛选结果':'全选'
    selection.textContent=`已选 ${selected.size} / ${rows.length} 项${selected.size>n ? `（其中 ${selected.size-n} 项不在当前筛选内）` : ''}`
    if(headerCheck){headerCheck.checked=visible.length>0&&n===visible.length;headerCheck.indeterminate=n>0&&n<visible.length;headerCheck.disabled=!visible.length}
    toolbar.dispatchEvent(new Event('selectionchange'))
  }
  function draw(){
    scroller.replaceChildren();const table=el('table'),head=el('thead'),hr=el('tr'),checkCell=el('th')
    headerCheck=document.createElement('input');headerCheck.type='checkbox';headerCheck.setAttribute('aria-label','全选当前结果')
    headerCheck.onchange=()=>{for(const {key} of visibleRows())headerCheck.checked?selected.add(key):selected.delete(key);draw()}
    checkCell.append(headerCheck);hr.append(checkCell,el('th','名称 / 标识'),el('th','状态 / 类型'));head.append(hr);table.append(head)
    const body=el('tbody')
    for(const {row,i,key}of visibleRows()){
      const tr=el('tr','',selected.has(key)?'selected':''),td=el('td'),c=document.createElement('input');c.type='checkbox';c.checked=selected.has(key);c.setAttribute('aria-label',`选择 ${row?.ref??row?.title??row?.name??row}`)
      c.onchange=()=>{c.checked?selected.add(key):selected.delete(key);tr.classList.toggle('selected',c.checked);updateSelection()};td.onclick=e=>e.stopPropagation();td.append(c)
      const name=typeof row==='string'?row:row.title??row.name??row.symbol??row.id??String(i+1)
      const title=el('td',name,'title')
      if(row?.symbol)title.append(el('small',`${row.ref || '未设置代号'} · ${snapshot.strategies.find((s:any)=>s.id===row.strategyId)?.name??'策略缺失'}`))
      tr.append(td,title,el('td',row?.status??row?.tradeKind??''));tr.onclick=async()=>{if(await canLeave()){draftDirty=false;await inspect(row,i,inspector)}};body.append(tr)
    }
    table.append(body);scroller.append(table);updateSelection()
  }
  search.oninput=draw;strategyFilter.onchange=draw
  all.onclick=()=>{for(const {key}of visibleRows())selected.add(key);draw()}
  clear.onclick=()=>{selected.clear();draw()};draw()

}
async function inspect(row:any,index:number,panel:HTMLElement){
  const generation=++inspectionGeneration
  const current=()=>generation===inspectionGeneration&&panel.isConnected
  clearPreviewUrls()
  panel.replaceChildren();panel.append(el('h2',group==='config'?row.id:(row?.symbol ? `${row.ref || '未设置代号'} · ${row.symbol}` : row?.title??row?.name??'完整数据')))
  if(group==='assets'){panel.append(el('p',`${row.file_name} · ${row.byte_size} 字节`));try{const file=await readEditorAsset(source, row);if(!current())return;if(row.mime.startsWith('image/')&&!row.mime.includes('svg')){const img=document.createElement('img');img.src=URL.createObjectURL(file);urls.push(img.src);img.style.width='100%';panel.append(img)}}catch(e){if(current())panel.append(el('p',String(e)))}return}
  const value=group==='config'?row.value:row;const ta=document.createElement('textarea');ta.spellcheck=false;ta.value=JSON.stringify(value,null,2);ta.oninput=()=>{draftDirty=true};
  const fields:Record<string,string>={symbol:'交易品种',title:'标题',name:'名称',tags:'标签（逗号分隔）',mistakeTags:'错误标签（逗号分隔）'}
  if(group!=='config' && value && typeof value==='object'){
    const form=el('div','','fields')
    if(['live','case','paper'].includes(group)) {
      const field=document.createElement('label');field.textContent='策略'
      const select=strategySelect('交易策略','选择策略');select.value=value.strategyId
      select.onchange=()=>{if(!select.value)return;try{const current=JSON.parse(ta.value);current.strategyId=select.value;ta.value=JSON.stringify(current,null,2);draftDirty=true}catch{message('请先修正完整字段中的 JSON 格式。')}}
      field.append(select);form.append(field)
    }
    for(const [key,label]of Object.entries(fields)){
      if(!(key in value)||!(typeof value[key]==='string'||Array.isArray(value[key])))continue
      const field=document.createElement('label'),input=document.createElement('input');field.textContent=label;input.value=Array.isArray(value[key])?value[key].join(', '):value[key];
      input.onchange=()=>{try{const current=JSON.parse(ta.value);current[key]=Array.isArray(value[key])?input.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean):input.value;if(group==='quickNotes'&&key==='title')current.titleMode='manual';ta.value=JSON.stringify(current,null,2);draftDirty=true}catch{message('请先修正完整字段中的 JSON 格式，再使用快捷字段。')}};field.append(input);form.append(field)
    }
    panel.append(form)
  }
  panel.append(el('p','完整字段编辑 · 应用时校验，另存后生效'),ta)
  const apply = el('button', '应用编辑')
  apply.onclick = () => run(async () => {
    const edited = JSON.parse(ta.value)
    const next = structuredClone(snapshot)
    if (group === 'config') {
      next[row.id] = edited
    } else if (['live', 'case', 'paper'].includes(group)) {
      const tradeIndex = next.trades.findIndex(trade => trade.id === row.id)
      if (tradeIndex === -1) throw new Error('当前记录已不存在')
      next.trades[tradeIndex] = edited
    } else {
      const records = next[group]
      if (!Array.isArray(records)) throw new Error('当前分类不可编辑')
      records[index] = edited
    }
    commit(next, '已应用编辑')
  })
  panel.append(apply)
  const html= typeof value==='object' ? value.note??value.contentHtml : null
  if(typeof html==='string'&&html){const details=document.createElement('details');details.append(el('summary','正文与截图预览'));const preview=el('div','','preview');const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style,iframe,object').forEach(n=>n.remove());preview.append(el('div',doc.body.textContent??''));for(const img of doc.querySelectorAll('img')){const src=img.getAttribute('src')??'';const a=source.assets.find(x=>src===`journal-asset://${x.id}`);if(a)try{const file=await readEditorAsset(source, a);if(!current())return;if(a.mime.includes('svg'))continue;const image=document.createElement('img');image.src=URL.createObjectURL(file);urls.push(image.src);preview.append(image)}catch{preview.append(el('p','附件无法读取'))}}details.append(preview);if(current())panel.append(details)}
}
$('open').onclick = () => run(async () => {
  if (!await canLeave()) return
  if (history.length && !await ask('打开另一份资料库', '将丢弃本页尚未导出的修改。')) return
  if (!('showDirectoryPicker' in window)) throw new Error('请使用桌面 Chrome / Edge 打开此文件。')
  const directory = await window.showDirectoryPicker({ mode: 'read' })
  const opened = await openEditorLibrary(await SQL, directory)
  source = opened.source
  snapshot = opened.snapshot
  history = []
  selected.clear()
  draftDirty = false
  render()
  $('source').textContent = `${directory.name} · 只读源目录`
  message('已打开。选择分类开始整理；原目录不会被修改。')
})
$('undo').onclick = () => run(async () => {
  if (!await canLeave()) return
  const previous = history.pop()
  if (!previous) return
  snapshot = previous
  draftDirty = false
  selected.clear()
  render()
  message('已撤销上一次修改')
})
$('check').onclick = () => run(async () => {
  if (draftDirty) throw new Error('请先应用右侧草稿，再校验。')
  await checkEditorLibrary(source, snapshot)
  message(`校验通过 · ${snapshot.trades.length} 条交易 · ${source.assets.length} 个附件`)
})
$('export').onclick = () => run(async () => {
  if (draftDirty) throw new Error('请先应用右侧草稿，再另存。')
  // Keep the picker directly in the user gesture before asynchronous validation.
  const destination = await window.showDirectoryPicker({ mode: 'readwrite' })
  const copied = await exportEditorLibrary(await SQL, source, snapshot, destination, message)
  message(`导出完成：${destination.name} · journal.db、manifest.json 与 ${copied} 个附件已核验。请在 Atlas 选择此目录本身。`)
})
window.addEventListener('beforeunload',e=>{if(history.length||draftDirty||busy){e.preventDefault();e.returnValue=''}})
