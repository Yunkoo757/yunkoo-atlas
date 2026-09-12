
 'use strict';
import Scenario from './scenario.js';
 const navs={1:'简单结构顺势',2:'复杂回调后顺势',3:'参与复杂回调',4:'HTF强推动',5:'MTF强推动'};
 const periods={ '4H/15m/1m':['4H','15m','1m','5m'], '1H/15m/1m':['1H','15m','1m','5m'], '1H/5m/1m':['1H','5m','1m',null], '日线/1H/5m':['日线','1H','5m','15m'] };
 const defaults={scenario:null,mode:'record',date:'',symbol:'',nav:'1',side:'long',period:'4H/15m/1m',stage:'2M',reference:false,retry:false,htfLocation:'default',htfLiquidity:'htf',htfReaction:'touch',location:'poi',alignment:'2M',trigger:'choch',entry:'poi',sl:'ltf',be:'auto',target:'auto',manage:'target',outcome:'plan',beText:'',targetText:'',extra:''};
 const copy=x=>JSON.parse(JSON.stringify(x));
 function normalize(raw){
  const s={...defaults,...raw};
  if(!navs[s.nav])s.nav='1';if(!periods[s.period])s.period='4H/15m/1m';
  if(!['long','short'].includes(s.side))s.side='long';
  if(!['ibos','bos','2M','3C'].includes(s.alignment))s.alignment='bos';
  if(!periods[s.period][3])s.reference=false;
  if(s.nav==='5'){if(!periods[s.period][3])s.period='4H/15m/1m';s.reference=true;s.retry=false;}
  if(!['2M','3C','simple'].includes(s.stage))s.stage='2M';
  if(s.nav==='2'&&s.stage==='simple')s.stage='2M';
  if(s.nav==='4'||s.nav==='5')s.manage='dynamic';
  if(!['second','flip'].includes(s.trigger)&&s.entry==='break')s.entry='poi';
  if(s.trigger==='flip'&&s.entry==='break')s.entry='poi';
  if(s.outcome==='miss'&&s.entry==='market')s.outcome='plan';
  return s;
 }
 function context(s){const [h,m,l,r]=periods[s.period],t=s.reference?r:m,up=s.side==='long';return {h,m,l,r,t,up,dir:up?'看涨':'看跌',opp:up?'看跌':'看涨',move:up?'向上':'向下',hold:up?'demand':'supply',fail:up?'supply':'demand',high:up?'高':'低',low:up?'低':'高',front:up?'左上':'左下',back:up?'左下':'左上'};}
 function management(raw){const s=normalize(raw),c=context(s),{h,m,t,front,high}=c;
  const n2=s.nav==='2'||s.nav==='5'&&s.stage!=='simple';
  const be={none:'不单列BE',auto:'按本分支建议',mtf:`${t}二次bos${front}${high}点`,htf3:`${h} 3C确认阶段${high}点`,custom:'手动指定BE对象'};
  const targets={auto:'按本分支建议',custom:'手动指定目标'};
  if(s.nav==='3')targets.internal=`${h}当前回调内部bos${front}弱势${high}点`;
  else {targets.wave=`${h}波段结构${front}弱势${high}点`;if(n2)targets.internal=`${h}内部bos${front}弱势${high}点`;targets.mtf=`${m}波段结构${front}弱势${high}点`;targets.outline=`${h}之前趋势${front}大轮廓流动性`;}
  if(n2&&s.stage==='2M')targets.two=`${h}内部弱势${high}点 → 波段弱势${high}点`;
  let b='',target='',why='';
  if(s.nav==='1'){b=`${t} ${s.alignment==='3C'?'3C':'2M'}对齐的${front}弱势${high}点`;target=targets.wave;why='导航1：MTF弱势点常作BE，HTF弱势点常作主要目标；实际对象可手动调整。';}
  if(n2){b=s.stage==='3C'?`${h} 3C确认阶段${high}点`:`${t} ${s.alignment==='3C'?'3C':'2M'}对齐的${front}弱势${high}点`;target=s.stage==='3C'?targets.wave:targets.two;why='导航2背景：区分HTF的2M与3C；内部目标和波段目标分开。';}
  if(s.nav==='3'){b=`${t} ${s.alignment==='3C'?'3C':'2M'}对齐的${front}弱势${high}点`;target=targets.internal;why='导航3：目标对应当前回调内部结构，不沿用原趋势远端极值。';}
  if(s.nav==='4'){b=`${m}${front}弱势结构${high}点`;target=targets.outline;why='导航4：MTF弱势点可作BE或部分TP，结合MTF结构及大轮廓流动性管理。';}
  if(s.nav==='5'){b='';if(!n2)target=targets.wave;why='导航5：没有统一固定BE点，不因刚推动一段就自动保本；目标随HTF背景选择。';}
  if(s.alignment==='ibos'&&s.be==='auto'){b='';why+=' 单独ibos不自动推导弱势点或二次bos保本位置。';}
  if(s.be==='none')b='';else if(s.be==='custom')b=s.beText.trim();else if(s.be!=='auto')b=be[s.be]||'';
  if(s.target==='custom')target=s.targetText.trim();else if(s.target!=='auto')target=targets[s.target]||'';
  const targetChoices=Object.fromEntries(Object.entries(targets).filter(([key])=>Scenario.allowedTargets(s).includes(key)));
  return {beChoices:be,targetChoices,be:b,target,why};
 }
 function generate(raw){const normalized=normalize(raw);if(normalized.scenario){try{const errors=Scenario.validate(normalized.scenario,normalized);return {state:normalized,text:errors.length?'':Scenario.render(normalized.scenario,normalized),warnings:errors,management:management(normalized),context:context(normalized),scenario:normalized.scenario};}catch{return {state:normalized,text:'',warnings:['场景数据损坏，请重新随机生成。'],management:management(normalized),context:context(normalized)};}}const s=normalized,c=context(s),{h,m,l,t,dir,opp,move,hold,fail,low,back}=c,g=management(s),warnings=Scenario.policyErrors(s,periods);
  if(s.retry&&s.sl==='mtf')warnings.push('第一单SL覆盖MTF叙述失效点，不能同时采用“MTF背景未变后ORA重入”。请按实际背景变化重新设置参与过程。');
  if(s.be==='custom'&&!s.beText.trim())warnings.push('填写已选的BE对象，或选择“不单列BE”。');
  if(!g.target)warnings.push('填写目标对象。');
  if(s.nav==='4'&&s.outcome==='tp')warnings.push('导航4全部退出需要明确大轮廓流动性或反向结构延续事件；手动选项尚未提供退出过程。');
  if((s.be==='htf3'||s.be==='auto'&&s.nav==='2'&&s.stage==='3C')&&['internal','mtf'].includes(s.target))warnings.push('当前BE位于所选最终TP之后，需调整管理对象。');
  if(s.outcome==='be'&&!g.be)warnings.push('保本退出需要指定本单采用的BE对象。');
  if(s.target!=='auto'&&s.target!=='custom'&&!g.targetChoices[s.target])warnings.push('当前目标不适用于所选导航，请重新选择。');
  let htf='';
  if(s.nav==='1')htf=`${h}波段结构${dir}，当前为简单结构，回到打破结构前最后一个${hold} POI，切${m}观察。`;
  if(s.nav==='2')htf=`${h}波段结构${dir}，右侧复杂回调后发生${h}本级别${s.stage}对齐，触及对应POI后切${m}观察。`;
  if(s.nav==='3')htf=`${h}原波段结构${opp}，右侧复杂回调，当前内部结构由${hold}控制，本次参与回调内部${move}的一段。`;
  if(s.nav==='4')htf=`${h}打破结构后强烈${move}推动，专注${m}当前最新${dir}结构。`;
  if(s.nav==='5')htf=s.stage==='simple'?`${h}波段结构${dir}，当前为简单结构。`:`${h}波段结构${dir}，复杂回调后发生本级别${s.stage}对齐。`;
  if(s.htfLocation==='modelC'){
   const q=s.htfLiquidity==='mtf'?m:h;
   if(s.nav==='1')htf=`${h}波段结构${dir}，当前为简单结构。`;
   if(s.nav==='2')htf=`${h}波段结构${dir}，右侧复杂回调后发生${h}本级别${s.stage}对齐。`;
   htf+=`${h}对应${hold} POI与前方${q}结构${low}点流动性形成POI＋流动性模型C；`+(s.htfReaction==='wait'?`等待该结构点被扫描并触及${h} POI，再切${m}观察。`:`扫描该结构点并触及${h} POI后，切${m}观察。`);
  }
  const lines=[['HTF',htf]];
  if(s.reference)lines.push([`MTF-${m}`,s.nav==='5'?`${m}发生2M对齐并强烈${move}推动，添加参考MTF ${t}，专注其最新顺势结构。`:s.nav==='4'?`${m}当前强烈${dir}推动，添加参考MTF ${t}观察最新结构。`:`${m}对齐位置较远，触及${m}极端POI后添加参考MTF ${t}观察。`]);
  const align={ibos:`${t}发生ibos，按激进的2M阶段观察`,bos:`${t}发生bos，开启2M阶段，对齐${dir}方向`,'2M':`${t}发生ibos＋二次bos，对齐${dir}方向`,'3C':`${t}发生3C确认对齐`}[s.alignment];
  const locations={poi:`标出对应${hold} POI，触及后切${l}观察`,modelC:`对应${hold} POI与前方结构${low}点形成POI＋流动性模型C，扫描该结构点并触及POI后切${l}观察`,noA:`对应POI前有no IDM模型，扫描该no IDM POI${s.side==='long'?'下沿':'上沿'}流动性发生预期A，等待${t} sweep前最后一个${fail} fails，再切${l}观察`,noB:`对应POI前有no IDM模型，扫描预期B早期诱导流动性后切${l}观察`};
  lines.push([s.retry?'MTF-1':s.reference?`MTF-${t}（参考）`:'MTF',`${align}；${locations[s.location]||locations.poi}。`]);
  const triggers={choch:'choch对齐',second:'choch＋二次bos确认对齐',flip:'flip对齐'};
  const setup=s.entry==='market'?'市价进场':s.entry==='break'?'在二次bos处设置突破单':s.trigger==='flip'?'在flip POI挂单':'在决策POI挂单';
  const stop=s.sl==='mtf'?`${t}叙述背景失效${low}点`:`${l}本单失效${low}点`;
  const reaction=s.location==='noB'||s.location==='modelC'?`上述扫描后，${l}发生sweep前最后一个${fail} fails；`:'';
  const ltf=reaction+`${l}发生${triggers[s.trigger]||triggers.choch}，${setup}，SL覆盖${stop}。`;
  if(s.retry){lines.push(['LTF-1',ltf+'成交后止损。']);lines.push([`MTF-2（${t}重新观察）`,`切回${t}观察，原叙述失效点未被打破；出现逆向订单流后，${t}本级别打破最后一个${fail}，发生ORA再对齐，等待新POI的市场反应。`]);lines.push(['LTF-2',`触及上述ORA留下的新${t} POI后，${l}发生本次${triggers[s.trigger]||triggers.choch}，${setup}，SL覆盖本次${stop}。`]);}
  else lines.push(['LTF',ltf]);
  let tp=[g.be?`${g.be}作为BE参考`:'',g.target?g.target.includes(' → ')?g.target.replace(' → ','作为TP1，')+'作为TP2':`${g.target}作为主要TP`:''].filter(Boolean).join('，');
  if(s.manage==='dynamic')tp+=`；后续关注${s.nav==='5'?t:m}最新结构，${s.nav==='4'?`${m}反向打破并继续产生反向新结构，或打破上述目标流动性时考虑退出`:'结合原SL和目标处理，不因刚推动一段就推仓保本'}`;
  const results={plan:'',tp:'已到达上述目标并止盈退出。',sl:'触及SL，止损退出。',be:'到达上述BE位置后移动SL至进场价，随后回撤保本退出。',miss:'价格未回到挂单位置，撤单；本次未执行BE或TP。'};
  lines.push(['TP管理',(tp?tp+'。':'')+(results[s.outcome]||'')]);
  if(s.htfLocation==='modelC'&&s.htfReaction==='wait'){lines.splice(1);lines.push(['TP管理','当前等待HTF模型的市场反应，具体参与与管理计划在后续对齐后设置。']);}
  if(s.extra.trim())lines.push(['补充',s.extra.trim()]);
  const title=[s.date,s.symbol.trim()?s.symbol.trim()+'案例分析':'案例分析',`导航${s.nav}`,s.side==='long'?'多单':'空单'].filter(Boolean).join('，')+(s.mode==='simulation'?'（虚构模拟）':'')+'：';
  return {state:s,text:warnings.length?'':title+'\n\n'+lines.map(([k,v])=>k+'：'+v).join('\n\n'),warnings,management:g,context:c};
 }
 function candidate(rng=Math.random,locks={}){const pick=a=>a[Math.floor(rng()*a.length)];let s={...defaults,mode:'simulation',symbol:pick(['GU','EU','AU','XAUUSD','BTCUSDT']),nav:pick(Object.keys(navs)),side:pick(['long','short']),period:pick(Object.keys(periods)),stage:pick(['simple','2M','3C']),reference:rng()>.5,retry:rng()>.75,location:pick(['poi','modelC','noA','noB']),alignment:pick(['ibos','bos','2M','3C']),trigger:pick(['choch','second','flip']),entry:pick(['poi','market','break']),sl:pick(['ltf','mtf'])};
  if(locks.period){if(!periods[locks.period])throw Error('锁定的周期组合无效');s.period=locks.period;if(!periods[s.period][3]&&s.nav==='5')s.nav=pick(['1','2','3','4']);}
  s=normalize(s);
  // Sample HTF location independently from the execution-MTF location.
  // These routes explicitly wait for HTF location; strong-push routes do not.
  if(['1','2'].includes(s.nav))s.htfLocation=pick(['default','modelC']);
  if(s.htfLocation==='modelC'){
   s.htfLiquidity=pick(['htf','mtf']);
   s.htfReaction=locks.includeWaiting===true?pick(['touch','wait']):'touch';
   if(s.htfReaction==='wait'){s.retry=false;s.outcome='plan';}
  }
  if(s.nav==='3'&&s.location==='modelC')s.location=pick(['poi','noA','noB']);
  if(s.alignment==='ibos'&&!locks.includeHistorical)s.alignment='bos';
  if(s.alignment==='ibos'){s.nav='1';s.reference=false;s.trigger='second';s.htfLocation='default';s.retry=false;}
  if(s.alignment==='ibos'){if(context(s).t!=='15m')s.alignment='bos';else s.location=pick(['poi','noB']);}
  if(s.nav==='5')s.sl='mtf';
  if(s.retry)s.sl='ltf';
  s.manage=['4','5'].includes(s.nav)?'dynamic':pick(['target','dynamic']);
  const choices=management(s);s.be=pick(Object.keys(choices.beChoices).filter(x=>s.nav==='5'?['auto','none'].includes(x):(x!=='mtf'||s.alignment==='2M')&&(x!=='htf3'||s.stage==='3C'&&s.nav==='2')));
  s.target=pick(Object.keys(choices.targetChoices));
  if(s.be==='custom')s.beText=`${context(s).t}本次对齐形成的${context(s).front}结构${context(s).high}点`;
  if(s.target==='custom')s.targetText=s.nav==='3'?`${context(s).h}当前回调内部bos${context(s).front}弱势${context(s).high}点`:`${context(s).h}波段结构${context(s).front}弱势${context(s).high}点`;
  s.outcome=pick(['plan','tp','sl','be','miss']);
  if(s.outcome==='be'&&!management(s).be)s.outcome=pick(['plan','tp','sl']);
  if(s.outcome==='miss')s.entry='poi';
  if(s.htfLocation==='modelC'&&s.htfReaction==='wait'){s.retry=false;s.outcome='plan';}

  s=normalize(s);s.scenario=Scenario.build(s,periods);
  const errors=Scenario.validate(s.scenario,s);
  if(errors.length)throw Error('随机场景未通过规则校验：'+errors.join('；'));
  return s;
 }

 function random(rng=Math.random,locks={}){let error;for(let i=0;i<20;i++){try{const s=candidate(rng,locks);if(!locks.includeWaiting&&(s.scenario.waiting||!s.scenario.events.some(e=>e.id==='entry')||!s.scenario.management.targets?.length))throw Error('随机案例缺少完整参与与管理过程');return s;}catch(e){error=e;}}throw Error('未能生成通过检查的场景，原结果保留。'+(error?.message||''));}
 const api={defaults,navs,periods,normalize,management,generate,random,copy};export default api;
