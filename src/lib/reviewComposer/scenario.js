
 'use strict';
 // Coordinates are relative order in a synthetic model, never market prices.
 // Model qualification is an explicit premise; this is not a candle recognizer.
 const sources={N1:'思路框架v2.0：115行',N2:'思路框架v2.0：117—118行',N3:'思路框架v2.0：119—120行',N4:'思路框架v2.0：121行',N5:'思路框架v2.0：127行',C:'每日图表FX：2413行；学习交流：4214行'};
 function signature(s){return JSON.stringify(Object.entries(s).filter(([k])=>k!=='scenario').sort(([a],[b])=>a.localeCompare(b)));}
 // Shared applicability rules: used by random validation and manual generation.
 function allowedTargets(s){
  if(s.nav==='3')return ['auto','custom','internal'];
  if(s.nav==='5')return s.stage==='2M'?['auto','custom','internal','wave','two']:['auto','custom','wave'];
  if(s.nav==='2'&&s.stage==='3C')return ['auto','custom','wave'];
  return s.nav==='2'?['auto','custom','wave','internal','two']:['auto','custom','wave','mtf','outline'];
 }
 function policyErrors(s,periods){
  const e=[],p=periods[s.period],t=s.reference?p[3]:p[1];
  if(s.alignment==='ibos'&&(s.nav!=='1'||s.reference||s.retry||t!=='15m'||!['poi','noB'].includes(s.location)||s.trigger!=='second'))e.push('早期单ibos仅支持已查15m极端POI / 预期B路径及LTF二次确认；其他组合尚无对应依据。');
  if(s.nav==='5'&&s.sl!=='mtf')e.push('导航5需明确参考MTF保护对象；当前LTF失效点未证明覆盖参考MTF结构或sweep极值，请选择参考MTF失效点。');
  if(!(s.htfLocation==='modelC'&&s.htfReaction==='wait')&&!allowedTargets(s).includes(s.target))e.push('该目标不适用于当前导航和HTF阶段，需另行提供改变管理计划的依据。');
  return e;
 }
 function build(s,periods){
  const [h,m,l,r]=periods[s.period],t=s.reference?r:m,up=s.side==='long',direction=up?1:-1;
  const g={version:5,ruleProfile:s.alignment==='ibos'?'historical-aggressive':'current',signature:signature(s),nav:s.nav,stage:s.stage,direction,periods:{h,m,l,t},source:sources['N'+s.nav],objects:[],events:[],models:[],management:{},waiting:s.htfLocation==='modelC'&&s.htfReaction==='wait'};
  const O=(id,tf,role,rank,parent=null)=>{g.objects.push({id,tf,role,rank:rank*direction,parent});return id;};
  const event=(id,type,tf,refs=[],requires=[])=>{g.events.push({id,type,tf,refs,requires});return id;};
  const background=event('background','background',h);const ha=event('htf-aligned',s.nav==='2'||s.nav==='5'&&s.stage!=='simple'?'htf-'+s.stage:s.nav==='3'?'internal-control':s.nav==='4'?'strong-htf':'simple-htf',h,[],[background]);
  O('htf-stop',h,'invalidation',-6);O('htf-poi',h,'poi',-5,'htf-stop');
  O('htf-internal',h,'internal-target',7);O('htf-wave',h,'wave-target',11);O('htf-confirm',h,'confirmation-target',8);O('htf-outline',h,'outline-target',13);
  event('htf-objects','objects',h,['htf-stop','htf-poi','htf-internal','htf-wave','htf-confirm','htf-outline'],[ha]);
  O('original-mtf-target',m,'wave-target',6);O('original-mtf-poi',m,'poi',-3);event('original-mtf-objects','objects',m,['original-mtf-target','original-mtf-poi'],['htf-objects']);
  let location='htf-objects';
  if(s.htfLocation==='modelC'){
   O('htf-liquidity',s.htfLiquidity==='mtf'?m:h,'liquidity',-3);
   event('htf-liquidity-formed','objects',s.htfLiquidity==='mtf'?m:h,['htf-liquidity'],['htf-objects']);
   g.objects.find(x=>x.id==='htf-poi').bounds=[-5.2,-4.8].map(x=>x*direction).sort((a,b)=>a-b);
   g.models.push({id:'C-HTF',poi:'htf-poi',liquidity:'htf-liquidity',source:sources.C});
   if(!g.waiting)location=event('htf-sweep','sweep',h,['htf-poi','htf-liquidity'],['htf-liquidity-formed']);
  }else if(['1','2'].includes(s.nav))location=event('htf-touch','touch',h,['htf-poi'],['htf-objects']);
  if(g.waiting)return g;
  if(s.nav==='5')location=event('mtf-push','strong-mtf',m,[],[location]);
  if(s.reference){if(s.nav==='3')location=event('reference-location-touch','touch',m,['original-mtf-poi'],['original-mtf-objects']);location=event('reference','reference',t,s.nav==='3'?['original-mtf-poi']:[],[location]);}
  const historicalB=s.alignment==='ibos'&&s.location==='noB';
  if(!historicalB)event('mtf-align','mtf-'+s.alignment,t,[],[location]);
  O('mtf-stop',t,'invalidation',-2);O('mtf-poi',t,'poi',-1,'mtf-stop');O('mtf-target',t,'alignment-target',4);
  event('mtf-objects','objects',t,['mtf-stop','mtf-poi','mtf-target'],[historicalB?location:'mtf-align']);
  let triggerAt='mtf-touch';
  if(s.location==='modelC'){
   O('mtf-liquidity',t,'liquidity',-.5);O('modelC-control',l,'control',.5,'mtf-liquidity');event('mtf-liquidity-formed','objects',t,['mtf-liquidity','modelC-control'],['mtf-objects']);
   g.objects.find(x=>x.id==='mtf-poi').bounds=[-1.2,-.8].map(x=>x*direction).sort((a,b)=>a-b);
   g.models.push({id:'C-MTF',poi:'mtf-poi',liquidity:'mtf-liquidity',source:sources.C});
   event('mtf-sweep','sweep',t,['mtf-poi','mtf-liquidity'],['mtf-liquidity-formed']);
   triggerAt=event('modelC-fails','control-fails',l,['modelC-control'],['mtf-sweep']);
  }else if(['noA','noB'].includes(s.location)){
   O('no-idm',t,'model',-1,'mtf-poi');
   O('no-liquidity',t,s.location==='noA'?'poi-boundary-liquidity':'early-inducement',s.location==='noA'?-1:-.5,'mtf-poi');
   O('no-sweep-extreme',t,'invalidation',s.location==='noA'?-1.2:-.7,'no-liquidity');
   O('pre-sweep-control',s.location==='noA'?t:l,'control',.5,'no-liquidity');
   event('no-idm-formed','no-idm',t,[],['mtf-objects']);
   event('expectation','objects',t,['no-idm','no-liquidity','no-sweep-extreme','pre-sweep-control'],['no-idm-formed']);
   event('no-sweep',s.location==='noA'?'expectation-A-sweep':'expectation-B-sweep',t,['no-liquidity','no-sweep-extreme'],['expectation']);
   if(historicalB)event('mtf-align','mtf-ibos',t,[],['no-sweep']);
   triggerAt=event('control-fails','control-fails',s.location==='noA'?t:l,['pre-sweep-control'],historicalB?['no-sweep','mtf-align']:['no-sweep']);
  }else event('mtf-touch','touch',t,['mtf-poi'],['mtf-objects']);
  O('ltf-stop',l,'invalidation',-.3);O('entry-poi',l,'entry',0,'ltf-stop');
  event('ltf-objects','objects',l,['ltf-stop','entry-poi'],[triggerAt]);
  event('ltf-align',s.trigger,l,['entry-poi'],['ltf-objects']);
  event('entry','entry-plan',l,['entry-poi',s.sl==='mtf'?'mtf-stop':'ltf-stop'],['ltf-align']);
  const n2=s.nav==='2'||s.nav==='5'&&s.stage!=='simple';
  g.management={entry:'entry-poi',sl:s.sl==='mtf'?'mtf-stop':'ltf-stop',be:s.nav==='5'?null:n2&&s.stage==='3C'?'htf-confirm':'mtf-target',targets:s.nav==='3'?['htf-internal']:n2&&s.stage==='2M'?['htf-internal','htf-wave']:s.nav==='4'?['htf-outline']:['htf-wave'],dynamic:['4','5'].includes(s.nav)||s.manage==='dynamic'};
  if(s.be==='none'||s.alignment==='ibos'&&s.be==='auto')g.management.be=null;
  if(s.be==='mtf')g.management.be='mtf-target';
  if(s.be==='htf3')g.management.be='htf-confirm';
  if(s.be==='custom')g.management.be='mtf-target';
  const targetIds={internal:['htf-internal'],wave:['htf-wave'],mtf:['original-mtf-target'],outline:['htf-outline'],two:['htf-internal','htf-wave'],custom:[s.nav==='3'?'htf-internal':'htf-wave']};
  if(targetIds[s.target])g.management.targets=targetIds[s.target];
  if(s.nav==='4')g.management.partialTarget='original-mtf-target';
  g.management.stopProtection=s.nav==='5'?'mtf-stop':null;
  g.management.targetRole=s.nav==='4'?'reference':'exit';
  g.management.exitBasis=s.nav==='4'?(g.management.targets.includes('htf-outline')?'outline':'reverse-structure'):'target';
  g.management.exitWatch=g.management.dynamic?{timeframe:s.nav==='4'?m:t,trigger:'reverse-break-and-continuation'}:null;
  if(s.retry){
   event('first-fill','fill',l,['entry-poi'],['entry']);event('first-stop','stop',l,['ltf-stop'],['first-fill']);
   event('background-intact','background-intact',t,s.location==='noA'?['mtf-stop','no-sweep-extreme']:['mtf-stop'],['first-stop']);
   O('retry-control',t,'control',1);event('reverse-flow','objects',t,['retry-control'],['background-intact']);
   event('ora','ORA',t,['retry-control'],['reverse-flow']);
   O('retry-poi',t,'poi',1);O('retry-stop',l,'invalidation',1.2);O('retry-entry',l,'entry',1.5,'retry-stop');
   event('retry-objects','objects',t,['retry-poi','retry-stop','retry-entry'],['ora']);
   event('retry-touch','touch',t,['retry-poi'],['retry-objects']);event('retry-align',s.trigger,l,['retry-entry'],['retry-touch']);
   event('retry-entry-plan','entry-plan',l,['retry-entry','retry-stop'],['retry-align']);
   g.management.entry='retry-entry';g.management.sl='retry-stop';
  }
  const lastEntry=s.retry?'retry-entry-plan':'entry';
  if(s.outcome==='miss')event('cancel','cancel',l,[g.management.entry],[lastEntry]);
  else if(s.outcome!=='plan'){
   event('fill','fill',l,[g.management.entry],[lastEntry]);
   if(s.outcome==='tp'){
    if(g.management.exitBasis==='reverse-structure'){
     event('exit-reverse-break','reverse-break',m,['original-mtf-target'],['fill']);
     O('dynamic-exit-price',l,'exit-price',3);event('dynamic-exit-quote','objects',l,['dynamic-exit-price'],['exit-reverse-break']);
     event('exit-reverse-continue','reverse-continuation',m,['original-mtf-target','dynamic-exit-price'],['exit-reverse-break']);
     event('exit','exit-dynamic',l,['dynamic-exit-price'],['exit-reverse-continue']);
    }else{event('target-hit','target-hit',t,g.management.targets,['fill']);event('exit','exit-tp',l,[g.management.entry],['target-hit']);}
   }
   if(s.outcome==='sl')event('exit','exit-sl',l,[g.management.sl],['fill']);
   if(s.outcome==='be'){event('be-hit','be-hit',t,g.management.be?[g.management.be]:[],['fill']);event('move-sl','move-sl',l,[g.management.entry],['be-hit']);event('exit','exit-be',l,[g.management.entry],['move-sl']);}
  }
  return g;
 }
 function validate(g,s){
  const errors=policyErrors(s,{[s.period]:[g?.periods?.h,g?.periods?.m,g?.periods?.l,g?.periods?.t]});const bad=x=>errors.push(x);
  if(g&&g.version<5)return ['旧版场景请重新随机生成，本次已更新对象与事件规则'];
  if(!g||g.version!==5||!Array.isArray(g.objects)||!Array.isArray(g.events)||!Array.isArray(g.models))return ['场景数据格式无效'];
  if(!['poi','modelC','noA','noB'].includes(s.location)||!['ibos','bos','2M','3C'].includes(s.alignment)||!['plan','tp','sl','be','miss'].includes(s.outcome))bad('场景包含未知分支');
  if(g.ruleProfile!==(s.alignment==='ibos'?'historical-aggressive':'current'))bad('激进观察与常规对齐范围不匹配');
  if(g.signature!==signature(s))bad('选项与场景不一致');
  if(g.nav!==s.nav||g.stage!==s.stage||g.direction!==(s.side==='long'?1:-1))bad('参与背景不一致');
  const objects=new Map(),events=new Map(),formed=new Set();
  for(const o of g.objects){if(objects.has(o.id))bad('结构对象ID重复');objects.set(o.id,o);if(!Object.values(g.periods).includes(o.tf)||!Number.isFinite(o.rank))bad('结构周期或位置无效');}
  for(const o of g.objects)if(o.parent&&!objects.has(o.parent))bad('父对象不存在');
  for(const e of g.events){if(events.has(e.id))bad('事件ID重复');if(!Array.isArray(e.requires)||!Array.isArray(e.refs)){bad('事件格式错误');continue;}for(const id of e.requires)if(!events.has(id))bad('前提尚未发生：'+id);for(const id of e.refs)if(!objects.has(id))bad('事件引用不存在的对象');
   if(e.type!=='objects')for(const id of e.refs)if(!formed.has(id))bad('对象未形成便被使用');
   if(e.type==='objects')e.refs.forEach(x=>formed.add(x));events.set(e.id,e);
  }
  if(!events.has('background')||!events.has('htf-aligned'))bad('缺少HTF背景');
  function needs(id,prerequisite){const e=events.get(id);if(!e?.requires?.includes(prerequisite))bad(id+'缺少必要衔接：'+prerequisite);}
  needs('htf-aligned','background');needs('htf-objects','htf-aligned');
  if((s.nav==='2'||s.nav==='5'&&s.stage!=='simple')&&events.get('htf-aligned')?.type!=='htf-'+s.stage)bad('缺少HTF本级别阶段对齐');
  if(events.get('htf-aligned')?.tf!==g.periods.h)bad('HTF对齐被下级周期替代');
  const modelIds=new Set();
  for(const model of g.models){const p=objects.get(model.poi),q=objects.get(model.liquidity);if(modelIds.has(model.id))bad('模型ID重复');modelIds.add(model.id);if(!p||!q||p.role!=='poi'||q.role!=='liquidity'||p.id===q.id)bad('模型C对象无效');else {if((q.rank-p.rank)*g.direction<=0)bad('模型C的流动性与POI前后关系错误');if(!Array.isArray(p.bounds)||p.bounds.length!==2||!p.bounds.every(Number.isFinite)||p.bounds[0]>=p.bounds[1]||p.rank<p.bounds[0]||p.rank>p.bounds[1]||q.rank>=p.bounds[0]&&q.rank<=p.bounds[1])bad('模型C的POI边界不清晰或流动性与区域重叠');}}
  if(s.htfLocation==='modelC'&&!modelIds.has('C-HTF'))bad('缺少HTF模型C');
  for(const [id,poi,liquidity] of [['C-HTF','htf-poi','htf-liquidity'],['C-MTF','mtf-poi','mtf-liquidity']]){
   const model=g.models.find(x=>x.id===id);if(model&&(model.poi!==poi||model.liquidity!==liquidity))bad('模型引用了另一轮的对象');
  }
  if(g.waiting){if(! (s.htfLocation==='modelC'&&s.htfReaction==='wait'))bad('等待状态不匹配');if(events.has('entry')||events.has('mtf-align')||Object.keys(g.management).length)bad('HTF未到位却已生成下级参与');return errors;}
  if(s.htfLocation==='modelC'&&!events.has('htf-sweep'))bad('HTF模型未反应便向下衔接');
  if(s.location==='modelC'&&!modelIds.has('C-MTF'))bad('缺少MTF模型C');
  for(const id of ['mtf-align','mtf-objects','ltf-align','entry'])if(!events.has(id))bad('缺少必要事件：'+id);
  if(events.get('mtf-align')?.tf!==g.periods.t||events.get('ltf-align')?.tf!==g.periods.l)bad('执行周期衔接错误');
  if(s.nav==='5'&&!events.has('mtf-push'))bad('导航5缺少MTF强推动');
  if(s.reference&&!events.has('reference'))bad('缺少参考周期衔接');
  const upstream=s.nav==='5'?'mtf-push':s.htfLocation==='modelC'?'htf-sweep':['1','2'].includes(s.nav)?'htf-touch':'htf-objects';
  if(s.reference){needs('reference',s.nav==='3'?'reference-location-touch':upstream);if(s.nav==='3'){needs('reference-location-touch','original-mtf-objects');if(events.get('reference-location-touch')?.refs?.[0]!=='original-mtf-poi'||events.get('reference')?.refs?.[0]!=='original-mtf-poi'||objects.get('original-mtf-poi')?.tf!==g.periods.m)bad('参考MTF切换没有绑定原MTF位置');}}
  const historicalB=s.alignment==='ibos'&&s.location==='noB';
  needs('mtf-align',historicalB?'no-sweep':s.reference?'reference':upstream);needs('mtf-objects',historicalB?(s.reference?'reference':upstream):'mtf-align');
  needs('ltf-objects',s.location==='modelC'?'modelC-fails':['noA','noB'].includes(s.location)?'control-fails':'mtf-touch');needs('ltf-align','ltf-objects');needs('entry','ltf-align');
  if(events.get('mtf-align')?.type!=='mtf-'+s.alignment||events.get('ltf-align')?.type!==s.trigger)bad('所选对齐与事件不匹配');
  if(s.htfLocation==='modelC'){needs('htf-liquidity-formed','htf-objects');needs('htf-sweep','htf-liquidity-formed');}
  if(s.location==='modelC'){needs('mtf-liquidity-formed','mtf-objects');needs('mtf-sweep','mtf-liquidity-formed');needs('modelC-fails','mtf-sweep');if(events.get('modelC-fails')?.refs?.[0]!=='modelC-control'||objects.get('modelC-control')?.parent!=='mtf-liquidity'||events.get('modelC-fails')?.tf!==g.periods.l)bad('模型C的LTF控制失败对象不明确');}
  if(g.management.targetRole!==(s.nav==='4'?'reference':'exit'))bad('目标角色与导航不一致');
  const {entry,sl,be,targets}=g.management,price=objects.get(entry)?.rank,stop=objects.get(sl);
  if(!stop||stop.role!=='invalidation'||(price-stop.rank)*g.direction<=0)bad('SL不在参与方向的失效侧');
  if(!Array.isArray(targets)||!targets.length)bad('缺少目标对象');
  let last=price;
  for(const id of targets||[]){const target=objects.get(id);if(!target||!formed.has(id)||!target.role.endsWith('target')||(target.rank-last)*g.direction<=0)bad('目标不存在、未形成或方向/顺序错误');last=target?.rank;}
  if(be&&(!formed.has(be)||(objects.get(be)?.rank-price)*g.direction<=0))bad('BE对象错误');
  if(s.nav==='3'&&targets?.some(id=>objects.get(id)?.role!=='internal-target'))bad('导航3套用了原趋势远端目标');
  if(s.nav==='5'&&(g.management.stopProtection!=='mtf-stop'||sl!=='mtf-stop'))bad('导航5 SL未绑定参考MTF保护对象');
  if(s.nav==='4'&&(g.management.targetRole!=='reference'||g.management.exitBasis!==(targets?.includes('htf-outline')?'outline':'reverse-structure')))bad('导航4参考目标不能自动充当全部退出依据');
  if(s.nav==='5'&&be)bad('导航5被强制补固定BE');
  if(s.nav==='2'&&s.stage==='3C'&&s.be==='auto'&&s.alignment!=='ibos'&&be!=='htf-confirm')bad('HTF 3C管理阶段错配');
  if((s.nav==='2'&&s.stage==='3C'||s.nav==='5'&&s.stage!=='2M')&&targets?.some(id=>id!=='htf-wave'))bad('本阶段主要目标须绑定HTF波段对象');
  if(s.nav==='5'&&s.stage==='2M'&&targets?.some(id=>!['htf-internal','htf-wave'].includes(id)))bad('导航5目标越过HTF阶段适用范围');
  if(g.management.targetRole==='exit'&&be&&targets?.length&&(objects.get(be)?.rank-objects.get(targets.at(-1))?.rank)*g.direction>=0)bad('BE必须位于最终退出目标之前，所有结果状态均检查');
  if(s.target==='auto'&&(s.nav==='2'||s.nav==='5'&&s.stage!=='simple')&&JSON.stringify(targets)!==JSON.stringify(s.stage==='2M'?['htf-internal','htf-wave']:['htf-wave']))bad('HTF阶段目标错配');
  if(sl!==(s.retry?'retry-stop':s.sl==='mtf'?'mtf-stop':'ltf-stop'))bad('SL与所选失效对象不一致');
  if(s.nav==='4'&&g.management.partialTarget!=='original-mtf-target')bad('动态部分管理缺少具体MTF目标');
  if(g.management.dynamic&&(!g.management.exitWatch||g.management.exitWatch.timeframe!==(s.nav==='4'?g.periods.m:g.periods.t)||g.management.exitWatch.trigger!=='reverse-break-and-continuation'))bad('动态管理的周期或条件未建模');
  if(['4','5'].includes(s.nav)&&!g.management.dynamic)bad('强推动管理分支丢失');
  if(['noA','noB'].includes(s.location)){
   needs('no-idm-formed','mtf-objects');needs('expectation','no-idm-formed');needs('no-sweep','expectation');needs('control-fails','no-sweep');
   const q=objects.get('no-liquidity'),poi=objects.get('mtf-poi');
   if(q?.parent!=='mtf-poi'||q?.role!==(s.location==='noA'?'poi-boundary-liquidity':'early-inducement'))bad('预期A/B的扫描对象混同');
   if(s.location==='noA'&&q?.rank!==poi?.rank)bad('预期A未扫描no IDM POI边界流动性');
   if(s.location==='noB'&&(q?.rank-poi?.rank)*g.direction<=0)bad('预期B诱导对象应位于POI前方');
   if(objects.get('pre-sweep-control')?.parent!=='no-liquidity')bad('扫描前控制区未绑定本次流动性');
   if(events.get('no-sweep')?.type!==(s.location==='noA'?'expectation-A-sweep':'expectation-B-sweep'))bad('no IDM预期错配');
   if(events.get('control-fails')?.tf!==(s.location==='noA'?g.periods.t:g.periods.l))bad('扫描后控制失败的周期错误');
  }
  if(s.retry){
   if(s.location==='noA'){if(!events.get('background-intact')?.refs.includes('no-sweep-extreme')||(objects.get('ltf-stop')?.rank-objects.get('no-sweep-extreme')?.rank)*g.direction<=0)bad('预期A扫描极值失效后不能沿用该模型重入');}
   if(s.sl==='mtf')bad('MTF失效止损后不能宣称背景未变');
   for(const [a,b] of [['first-fill','entry'],['first-stop','first-fill'],['background-intact','first-stop'],['reverse-flow','background-intact'],['ora','reverse-flow'],['retry-objects','ora'],['retry-touch','retry-objects'],['retry-align','retry-touch'],['retry-entry-plan','retry-align']])needs(a,b);
   if(events.get('ora')?.tf!==g.periods.t||events.get('retry-align')?.tf!==g.periods.l)bad('重入周期错配');
   if(entry!=='retry-entry')bad('第二单复用第一单入场对象');
   if((objects.get('ltf-stop')?.rank-objects.get('mtf-stop')?.rank)*g.direction<=0)bad('第一单止损已越过MTF失效点');
  }
  if(s.entry==='break'&&s.trigger!=='second')bad('没有二次bos却使用突破单');
  const lastEntry=s.retry?'retry-entry-plan':'entry';
  if(s.outcome==='plan'&&(events.has('fill')||events.has('exit')))bad('计划被写成已执行');
  if(s.outcome==='miss'){needs('cancel',lastEntry);if(s.entry!=='poi'||events.has('fill')||events.has('exit'))bad('未成交却执行仓位管理');}
  if(!['plan','miss'].includes(s.outcome))needs('fill',lastEntry);
  if(s.outcome==='tp'){
   if(g.management.exitBasis==='reverse-structure'){
    if((objects.get('dynamic-exit-price')?.rank-price)*g.direction<=0||!objects.has('dynamic-exit-price')||events.get('exit')?.refs?.[0]!=='dynamic-exit-price')bad('盈利动态退出缺少盈利侧成交对象');
    needs('dynamic-exit-quote','exit-reverse-break');
    if(events.get('exit-reverse-break')?.type!=='reverse-break'||events.get('exit-reverse-continue')?.type!=='reverse-continuation')bad('动态退出事件类型不匹配');
    needs('exit-reverse-break','fill');needs('exit-reverse-continue','exit-reverse-break');needs('exit','exit-reverse-continue');
    if(events.get('exit')?.type!=='exit-dynamic'||events.get('exit-reverse-break')?.tf!==g.periods.m||events.get('exit-reverse-continue')?.tf!==g.periods.m||events.has('target-hit'))bad('动态退出缺少原MTF反向结构延续依据');
   }else{needs('target-hit','fill');needs('exit','target-hit');if(events.get('exit')?.type!=='exit-tp')bad('止盈结果错误');}
  }
  if(s.outcome==='sl'){needs('exit','fill');if(events.get('exit')?.type!=='exit-sl')bad('止损结果错误');}
  if(s.be==='mtf'&&s.alignment!=='2M')bad('没有二次bos不能选择二次bos作为BE');
  if(s.be==='htf3'&&!(s.nav==='2'&&s.stage==='3C'))bad('未发生HTF 3C却引用其确认高低点');
  if(s.outcome==='be'&&be&&(objects.get(be)?.rank-objects.get(targets?.[0])?.rank)*g.direction>=0)bad('尚未到BE前已到止盈目标，不能描述原TP未到');
  if(s.outcome==='be'){if(!be)bad('无BE对象却保本退出');needs('be-hit','fill');needs('move-sl','be-hit');needs('exit','move-sl');if(events.get('exit')?.type!=='exit-be')bad('保本结果错误');}
  return errors;
 }
 function render(g,s){
  const errors=validate(g,s);if(errors.length)throw Error('场景校验失败：'+errors.join('；'));
  const {h,m,l,t}=g.periods,up=g.direction===1,dir=up?'看涨':'看跌',opp=up?'看跌':'看涨',hold=up?'demand':'supply',fail=up?'supply':'demand',low=up?'低':'高',high=up?'高':'低',front=up?'左上':'左下';
  const o=new Map(g.objects.map(x=>[x.id,x]));const name=id=>{const x=o.get(id);return ({'htf-internal':`${h}本次内部bos${front}弱势${high}点`,'htf-wave':`${h}波段结构${front}弱势${high}点`,'htf-confirm':`${h} 3C确认阶段${front}${high}点`,'htf-outline':`${h}之前趋势${front}大轮廓流动性`,'mtf-target':`${t}${s.retry?'第一轮':'本次'}对齐形成的${front}结构${high}点`,'original-mtf-target':`${m}波段结构${front}弱势${high}点`,'mtf-stop':`${t}本次叙述背景失效${low}点`,'ltf-stop':`${l}本单失效${low}点`,'retry-stop':`${l}第二单失效${low}点`})[id]||`${x.tf}${x.role}`;};
  let htf=s.nav==='3'?`${h}原波段结构${opp}，右侧复杂回调，当前内部结构由${hold}控制，参与回调内部${dir}的一段。`:s.nav==='4'?`${h}打破结构后强烈${dir}推动，专注${m}最新顺势结构。`:s.nav==='2'||s.nav==='5'&&s.stage!=='simple'?`${h}波段结构${dir}，复杂回调后发生本级别${s.stage}对齐。`:`${h}波段结构${dir}，当前最新结构简单。`;
  if(s.htfLocation==='modelC'){const q=o.get('htf-liquidity');htf+=`${h}对应${hold} POI与前方${q.tf}结构${low}点组成POI＋流动性模型C；${g.waiting?'等待扫描该点并触及':'扫描该点并触及'}${h} POI${g.waiting?'，再切':'后切'}${m}观察。`;}
  else if(['1','2'].includes(s.nav))htf+=`触及${h}对应${hold} POI后切${m}观察。`;
  const lines=[['HTF',htf]];
  if(!g.waiting){
   if(s.reference)lines.push([`MTF-${m}`,s.nav==='5'?`${m}发生2M对齐并强烈${dir}推动，添加参考MTF ${t}，专注最新顺势结构。`:s.nav==='4'?`添加参考MTF ${t}观察当前顺势结构。`:s.nav==='3'?`${m}对齐位置较远，触及${m}极端${hold} POI后，添加参考MTF ${t}观察该位置反应。`:`${m}对齐位置较远，添加参考MTF ${t}观察上述HTF位置的反应。`]);
   let mtf=`${t}发生${({ibos:'ibos，按激进2M方式观察',bos:'bos，开启2M阶段，对齐'+dir+'方向','2M':'ibos＋二次bos，对齐'+dir+'方向','3C':'3C确认对齐'})[s.alignment]}，形成新的${hold} POI。`;
   mtf+=s.location==='noA'?`该POI前无清晰IDM；价格扫描${t} no IDM POI${up?'下沿':'上沿'}的流动性，发生预期A，${t}打破该次sweep前最后一个${fail}，再切${l}观察。`:s.location==='noB'?`该POI前有no IDM模型，形成预期B早期诱导流动性，扫描该诱导点后切${l}观察。`:s.location==='modelC'?`该${t} POI与随后形成的前方${t}结构${low}点组成${s.htfLocation==='modelC'?'另一组':'一组'}模型C；扫描这个新结构点并触及该POI后切${l}。`:`回踩该${t} POI后切${l}观察。`;
   if(s.alignment==='ibos'&&s.location==='noB')mtf=`${t}原有${hold} POI前有no IDM模型；预期B早期诱导流动性被扫描后，${t}发生ibos，按激进2M方式观察，切${l}等待二次确认。`;
   lines.push([s.retry?`MTF-1（${t}${s.reference?'参考':''}）`:s.reference?`MTF-${t}（参考）`:'MTF',mtf]);
   const signal=s.trigger==='second'?'choch＋二次bos':s.trigger==='flip'?'flip':'choch';
   const reaction=s.location==='noA'?`上述${t}控制区失败后，${l}发生${signal}对齐`:['modelC','noB'].includes(s.location)?`针对上述${t}${s.location==='noB'?'预期B诱导点':'模型C结构点'}的扫描，${l}发生sweep前最后一个${fail} fails，${signal}表明对齐${dir}方向`:`触及上述${t} POI后，${l}发生${signal}对齐`;
   const entry=s.entry==='market'?'市价参与':s.entry==='break'?'在二次bos处设置突破单':`在${s.trigger==='flip'?'flip':'决策'}POI挂单`;
   lines.push([s.retry?'LTF-1':'LTF',`${reaction}，${entry}，SL覆盖${name(s.retry?'ltf-stop':g.management.sl)}。${s.retry?'成交后止损。':''}`]);
   if(s.retry){lines.push([`MTF-2（${t}重新观察）`, `第一单止损未破坏${t}原失效点；后续出现逆向订单流，${t}打破该段最后一个${fail}，发生ORA再对齐，标出新的${hold} POI。`]);lines.push(['LTF-2',`触及上述新${t} POI后，${l}发生本次${signal}对齐，${entry}，SL覆盖${name('retry-stop')}。`]);}

   const mg=g.management;let tp=mg.be?`${name(mg.be)}作为BE参考；`:'';
   tp+=mg.targets.map((id,i)=>`${name(id)}作为${mg.targets.length>1?'TP'+(i+1):'主要TP'}`).join('，')+'。';
   if(s.nav==='4'){
    tp=mg.be?`${name(mg.be)}作为BE参考；`:'';
    tp+=`${name(mg.partialTarget)}作为部分TP参考。`;
    if(!mg.targets.includes(mg.partialTarget))tp+=`${mg.targets.map(name).join('、')}作为目标流动性。`;
    if(!(s.outcome==='tp'&&mg.exitBasis==='reverse-structure'))tp+=`跟踪${mg.exitWatch.timeframe}，反向打破并继续形成反向结构时考虑退出。`;
   }
   
   if(!['4','5'].includes(s.nav)&&mg.dynamic&&s.outcome==='plan')tp+=`计划跟踪${mg.exitWatch.timeframe}结构，反向打破并继续产生反向新结构时考虑退出。`;
   const outcomes={plan:'',tp:'本次成交后到达上述目标，止盈退出。',sl:'本次成交后触及SL，止损退出。',be:'本次到达BE位置后将SL移至进场价，随后回撤保本退出。',miss:'本次挂单未成交，已撤单，未执行BE或TP。'};
   const result=s.outcome==='tp'&&mg.exitBasis==='reverse-structure'?`本次成交后，${mg.exitWatch.timeframe}反向打破并继续形成反向结构，按动态条件退出。`:outcomes[s.outcome];
   lines.push(['TP管理',tp+(s.retry?result.replace('本次','第二单'):result)]);
  }else lines.push(['TP管理','等待HTF模型反应，后续参与成立后再确定本单管理对象。']);
  return `${s.symbol}案例分析，导航${s.nav}，${up?'多单':'空单'}（虚构模拟${g.ruleProfile==='historical-aggressive'?' · 单独ibos·激进观察':''}）：\n\n`+lines.map(([k,v])=>k+'：'+v).join('\n\n');
 }
 const api={build,validate,render,signature,sources,policyErrors,allowedTargets};export default api;

