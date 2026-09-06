import { decode, validate, migrateToPaper, resetLive, addTagPresets, assignStrategy, SCHEMA_VERSION } from './core'
import { assertSafeAssetId } from '../../src/storage/assetId'
declare const initSqlJs: any
declare global { interface Window { ATLAS_SQLITE_BYTES: string } }
const $ = (id: string) => document.getElementById(id)!
const el = (tag: string, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n }
const SQL = initSqlJs({ wasmBinary: Uint8Array.from(atob(window.ATLAS_SQLITE_BYTES), c => c.charCodeAt(0)) })
let source: any, snapshot: any, assets: any[] = [], group = 'live', selected = new Set<string>(), history: any[] = [], draftDirty = false, busy = false
let urls: string[] = []
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
function dataRows(){ if(['live','case','paper'].includes(group))return snapshot.trades.filter((t:any)=>t.tradeKind===group);if(group==='assets')return assets; if(group==='config')return Object.keys(snapshot).map(key=>({id:key,title:key,value:snapshot[key]}));return snapshot[group] ?? [] }
function commit(next:any,label:string){validate(next);history.push(snapshot);snapshot=next;draftDirty=false;selected.clear();render();message(`${label} · 待另存，可撤销（${history.length} 次修改）`)}
function render(){
  urls.forEach(URL.revokeObjectURL);urls=[];controls();$('nav').replaceChildren()
  for(const [key,label] of Object.entries(labels)){const b=el('button',label,key===group?'active':'');const n= key==='config'?Object.keys(snapshot).length:key==='assets'?assets.length:['live','paper','case'].includes(key)?snapshot.trades.filter((t:any)=>t.tradeKind===key).length:(snapshot[key]?.length??0);b.append(el('span',String(n)));b.onclick=async()=>{if(await canLeave()){group=key;draftDirty=false;selected.clear();render();message(history.length ? '当前修改尚未另存，可继续整理。' : '已打开。源资料库只读。')}};$('nav').append(b)}
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
  panel.replaceChildren();panel.append(el('h2',group==='config'?row.id:(row?.symbol ? `${row.ref || '未设置代号'} · ${row.symbol}` : row?.title??row?.name??'完整数据')))
  if(group==='assets'){panel.append(el('p',`${row.file_name} · ${row.byte_size} 字节`));try{const file=await assetFile(row);if(row.mime.startsWith('image/')&&!row.mime.includes('svg')){const img=document.createElement('img');img.src=URL.createObjectURL(file);urls.push(img.src);img.style.width='100%';panel.append(img)}}catch(e){panel.append(el('p',String(e)))}return}
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
  const b=el('button','应用编辑');b.onclick=()=>run(async()=>{const edited=JSON.parse(ta.value),next=structuredClone(snapshot);if(group==='config')next[row.id]=edited;else if(['live','case','paper'].includes(group)){const idx=next.trades.findIndex((x:any)=>x.id===row.id);next.trades[idx]=edited}else next[group][index]=edited;commit(next,'已应用编辑')});panel.append(b)
  const html= typeof value==='object' ? value.note??value.contentHtml : null
  if(typeof html==='string'&&html){const details=document.createElement('details');details.append(el('summary','正文与截图预览'));const preview=el('div','','preview');const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style,iframe,object').forEach(n=>n.remove());preview.append(el('div',doc.body.textContent??''));for(const img of doc.querySelectorAll('img')){const src=img.getAttribute('src')??'';const a=assets.find(x=>src===`journal-asset://${x.id}`);if(a)try{const file=await assetFile(a);if(a.mime.includes('svg'))continue;const image=document.createElement('img');image.src=URL.createObjectURL(file);urls.push(image.src);preview.append(image)}catch{preview.append(el('p','附件无法读取'))}}details.append(preview);panel.append(details)}
}
function rowsOf(db:any,sql:string){const r=db.exec(sql)[0];return r?r.values.map((v:any[])=>Object.fromEntries(r.columns.map((k:string,i:number)=>[k,v[i]]))):[]}
async function readBytes(dir:any,name:string){return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())}
function equal(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((v,i)=>v===b[i])}
async function assetFile(a:any){assertSafeAssetId(a.id);if(!a.file_name?.startsWith(`${a.id}.`)||/[\x00-\x1f<>:"/\\|?*]/.test(a.file_name)||/[. ]$/.test(a.file_name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(a.id))throw Error('附件文件名不兼容桌面资料库');const dir=await source.getDirectoryHandle('attachments');const file=await (await dir.getFileHandle(a.file_name)).getFile();if(file.size!==a.byte_size)throw Error(`附件尺寸不符：${a.file_name}`);return file}
async function check(){validate(snapshot);const ids=new Set(assets.map(a=>a.id));const text=JSON.stringify(snapshot);for(const match of text.matchAll(/journal-asset:\/\/([^"'\s<>\\]+)/g)){if(!ids.has(match[1]))throw Error(`缺失附件登记：${match[1]}`)}for(const a of assets)await assetFile(a);message(`校验通过 · ${snapshot.trades.length} 条交易 · ${assets.length} 个附件`)}
$('open').onclick=()=>run(async()=>{if(!await canLeave())return;if(history.length&&!await ask('打开另一份资料库','将丢弃本页尚未导出的修改。'))return;if(!('showDirectoryPicker' in window))throw Error('请使用桌面 Chrome / Edge 打开此文件。');const dir=await (window as any).showDirectoryPicker({mode:'read'});const bytes=await readBytes(dir,'journal.db');const db=new (await SQL).Database(bytes);try{const meta=Object.fromEntries(rowsOf(db,'SELECT key,value FROM meta').map((r:any)=>[r.key,r.value]));let manifest;try{manifest=JSON.parse(new TextDecoder().decode(await readBytes(dir,'manifest.json')))}catch(error){if(!(error instanceof DOMException && error.name==='NotFoundError') && !(error instanceof Error && error.message.startsWith('Missing ')))throw error;const recovery=JSON.parse(new TextDecoder().decode(await readBytes(dir,'editor-export-state.json')));if(recovery.format!=='atlas-editor-export-v1')throw Error('未找到有效的导出恢复记录');manifest=recovery.manifest;}const loaded=decode(JSON.parse(meta.snapshot),Number(meta.schemaVersion??manifest.schemaVersion));validate(loaded);const loadedAssets=rowsOf(db,'SELECT * FROM assets');source=dir;snapshot=loaded;assets=loadedAssets;history=[];selected.clear();draftDirty=false;render();$('source').textContent=`${dir.name} · 只读源目录`;message('已打开。选择分类开始整理；原目录不会被修改。')}finally{db.close()}})
$('undo').onclick=()=>run(async()=>{if(!await canLeave())return;snapshot=history.pop();draftDirty=false;selected.clear();render();message('已撤销上一次修改')})
$('check').onclick=()=>run(async()=>{if(draftDirty)throw Error('请先应用右侧草稿，再校验。');await check()})
async function write(dir:any,name:string,data:any){const h=await dir.getFileHandle(name,{create:true});const w=await h.createWritable();try{await w.write(data);await w.close()}catch(e){await w.abort().catch(()=>{});throw e}}
$('export').onclick=()=>run(async()=>{
  if(draftDirty)throw Error('请先应用右侧草稿，再另存。')
  // The picker stays directly in the user gesture, before long validation.
  const dest=await (window as any).showDirectoryPicker({mode:'readwrite'});if(await dest.isSameEntry(source)||await source.resolve(dest)!==null||await dest.resolve(source)!==null)throw Error('请选择源资料库之外的独立空目录。');for await(const _ of dest.values())throw Error('导出目录必须为空，请选择新的空目录。')
  await check();const db=new (await SQL).Database()
  const manifest={schemaVersion:SCHEMA_VERSION,libraryId:crypto.randomUUID(),createdAt:new Date().toISOString(),platform:'electron'}
  let phase='保存编辑副本',n=0
  const state=()=>JSON.stringify({format:'atlas-editor-export-v1',status:'incomplete',phase,copiedAssets:n,totalAssets:assets.length,manifest},null,2)
  try{
    db.run('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE assets (id TEXT PRIMARY KEY,mime TEXT NOT NULL,file_name TEXT NOT NULL,byte_size INTEGER NOT NULL,created_at TEXT NOT NULL);')
    for(const [key,value]of Object.entries({schemaVersion:String(SCHEMA_VERSION),snapshot:JSON.stringify(snapshot),snapshotRevision:'1'}))db.run('INSERT INTO meta VALUES (?,?)',[key,value])
    for(const a of assets)db.run('INSERT INTO assets VALUES (?,?,?,?,?)',[a.id,a.mime,a.file_name,a.byte_size,a.created_at])
    // Save the edited snapshot before the longer asset copy. No valid manifest until complete.
    await write(dest,'editor-export-state.json',state())
    await write(dest,'journal.db',db.export())
    const ad=await dest.getDirectoryHandle('attachments',{create:true});phase='复制附件'
    for(const a of assets){message(`正在导出到 ${dest.name} · 复制附件 ${n+1} / ${assets.length}`);const file=await assetFile(a);await write(ad,a.file_name,file);const copied=await readBytes(ad,a.file_name),input=new Uint8Array(await file.arrayBuffer());if(!equal(copied,input))throw Error(`附件复制校验失败：${a.file_name}`);n++}
    phase='核验数据库';message(`正在导出到 ${dest.name} · 核验数据库`)
    const reopened=new (await SQL).Database(await readBytes(dest,'journal.db'));try{if(rowsOf(reopened,'PRAGMA integrity_check')[0]?.integrity_check!=='ok')throw Error('导出数据库完整性检查失败');validate(decode(JSON.parse(rowsOf(reopened,"SELECT value FROM meta WHERE key='snapshot'")[0].value),SCHEMA_VERSION))}finally{reopened.close()}
    phase='写入清单';await write(dest,'manifest.json',JSON.stringify(manifest,null,2))
    const savedManifest=JSON.parse(new TextDecoder().decode(await readBytes(dest,'manifest.json')))
    if(savedManifest.libraryId!==manifest.libraryId)throw Error('清单回读校验失败')
    message(`导出完成：${dest.name} · journal.db、manifest.json 与 ${n} 个附件已核验。请在 Atlas 选择此目录本身。`)
  }catch(error){
    await write(dest,'editor-export-state.json',state()).catch(()=>{})
    throw Error(`导出未完成（${dest.name} / ${phase}，附件 ${n}/${assets.length}）：${error instanceof Error?error.message:String(error)}。请保留本页修改；该目录尚不可在 Atlas 打开。`)
  }finally{db.close()}

})
window.addEventListener('beforeunload',e=>{if(history.length||draftDirty||busy){e.preventDefault();e.returnValue=''}})
