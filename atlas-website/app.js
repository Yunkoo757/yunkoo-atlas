import {icon} from '/guide/icons.js';
// Header is present in the initial HTML to preserve first-paint geometry.
// The frame follows the actual text bounds; only the selected word stays sharp.
const focusLine = document.querySelector('.focus-line');
const focusTokens = [...document.querySelectorAll('.focus-token')];
const focusFrame = document.querySelector('.focus-frame');
const focusToggle = document.querySelector('#focus-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let focusIndex = 0, focusTimer, focusPaused = false;
function placeFocus(index) {
  focusIndex = index;
  focusTokens.forEach((word,i) => word.classList.toggle('is-focused', i === index));
  const word = focusTokens[index].getBoundingClientRect(), line = focusLine.getBoundingClientRect();
  focusFrame.style.transform = `translate(${word.left-line.left-10}px, ${word.top-line.top-4}px)`;
  focusFrame.style.width = `${word.width+20}px`;
  focusFrame.style.height = `${word.height+8}px`;
}
function stopFocus(){ clearTimeout(focusTimer); }
function scheduleFocus(){
  stopFocus();
  if (focusPaused || reducedMotion.matches || document.hidden || focusLine.matches(':hover') || focusLine.contains(document.activeElement)) return;
  focusTimer = setTimeout(() => {placeFocus((focusIndex+1)%focusTokens.length);scheduleFocus();},2200);
}
focusTokens.forEach((word,index) => {
  word.addEventListener('pointerenter',()=>{stopFocus();placeFocus(index);});
  word.addEventListener('focus',()=>{stopFocus();placeFocus(index);});
  word.addEventListener('click',()=>placeFocus(index));
});
focusLine.addEventListener('pointerleave',scheduleFocus);
focusLine.addEventListener('focusout',()=>requestAnimationFrame(scheduleFocus));
focusToggle.addEventListener('click',()=>{
  focusPaused = !focusPaused;
  focusToggle.setAttribute('aria-pressed',String(focusPaused));
  focusToggle.setAttribute('aria-label',focusPaused?'播放文字聚焦动效':'暂停文字聚焦动效');
  focusToggle.innerHTML = icon(focusPaused ? 'play' : 'pause','sm');
  scheduleFocus();
});
function initializeFocus(){
  focusLine.classList.toggle('focus-enabled',!reducedMotion.matches);
  focusToggle.hidden = reducedMotion.matches;
  focusFrame.style.transition = 'none';
  placeFocus(focusIndex);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{focusFrame.style.transition='';}));
  scheduleFocus();
}
new ResizeObserver(()=>placeFocus(focusIndex)).observe(focusLine);
document.fonts.ready.then(initializeFocus);
reducedMotion.addEventListener('change',initializeFocus);
document.addEventListener('visibilitychange',scheduleFocus);
const screens = {
cases:{copy:'按时间、标签和掌握状态整理案例。'},
board:{copy:'并排回看不同状态的案例。'},
detail:{copy:'回看依据、图表与复盘正文。'},
notes:{copy:'留下观察、情绪与纪律。'},
stats:{copy:'先定范围，再看盈亏、R 倍数与策略。'},
period:{copy:'从本周事实，到下周行动。'},
random:{copy:'抽看旧交易，检验自己的理解。'}
};
function bindTabs(selector, select) {
  const tabs = [...document.querySelectorAll(selector)];
  function activate(tab) {
    tabs.forEach(item => { const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; });
    select(tab);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', e => {
      const vertical = tab.parentElement.getAttribute('aria-orientation') === 'vertical';
      const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      let target;
      if (e.key === previous) target = tabs[(index + tabs.length - 1) % tabs.length];
      if (e.key === next) target = tabs[(index + 1) % tabs.length];
      if (e.key === 'Home') target = tabs[0];
      if (e.key === 'End') target = tabs.at(-1);
      if (target) { e.preventDefault(); activate(target); target.focus(); }
    });
  });
}
bindTabs('[data-tab]', tab => {
  const key = tab.dataset.tab, screen = screens[key];
  document.querySelector('#preview-demo').setAttribute('view',key);
  document.querySelector('#preview-copy').textContent = screen.copy;
  document.querySelector('#preview-guide').href='/guide/?lesson='+({cases:'case-library',board:'case-library',detail:'complete-review',notes:'quick-notes',stats:'read-statistics',period:'review-loop',random:'review-loop'}[key]);
  const composer=document.querySelector('#preview-composer');
  if(composer) composer.hidden=key!=='detail';
  document.querySelector('#preview-panel').setAttribute('aria-labelledby', tab.id);
  const page=[...document.querySelectorAll('[data-tab]')].indexOf(tab);
  document.querySelector('.deck-count').textContent=String(page+1).padStart(2,'0')+' / 07';
  if(!reducedMotion.matches) document.querySelector('.deck-front').animate([{opacity:.65},{opacity:1}],{duration:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--atlas-motion-page')),easing:'ease-out'});
});
const scenes = {
  daily: {label:'日常记录',title:'给每一笔交易留下上下文。',copy:'把交易事实、笔记和复盘放在一起，盘后继续整理。',steps:['记录交易','补充笔记','完成复盘']},
  weekly: {label:'每周复盘',title:'从一周交易里，看到下周方向。',copy:'回看执行、风险与情绪，留下一条下周能做的改进。',steps:['回看本周','整理问题','写下改进']},
  cases: {label:'案例积累',title:'把值得重看的交易留下来。',copy:'把代表性交易做成案例，再用回看和随机复盘检验理解。',steps:['选择交易','沉淀案例','再次回看']}
};
bindTabs('[data-scene]', tab => {
  const scene = scenes[tab.dataset.scene];
  for (const key of ['label','title','copy']) document.querySelector(`#scene-${key}`).textContent = scene[key];
  document.querySelector('#scene-steps').replaceChildren(...scene.steps.flatMap((text,i) => {
    const span = document.createElement('span'); span.textContent = text;
    if (!i) return [span]; const arrow = document.createElement('b'); arrow.innerHTML = icon('arrow','sm'); return [arrow,span];
  }));
  document.querySelector('#scene-panel').setAttribute('aria-labelledby', tab.id);
});

// Native horizontal navigation leaves the document's vertical scroll untouched.
const rail=document.querySelector('#feature-rail');
const railButtons=[...document.querySelectorAll('[data-rail]')];
function railState(){railButtons[0].disabled=rail.scrollLeft<2;railButtons[1].disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-2;const cards=[...rail.children];const first=cards.findIndex(c=>c.getBoundingClientRect().right>rail.getBoundingClientRect().left+8);document.querySelector('.rail-count').textContent=String(Math.max(0,first)+1).padStart(2,'0')+' — 09';}
railButtons.forEach(b=>b.addEventListener('click',()=>{pauseFlow();rail.scrollBy({left:Number(b.dataset.rail)*rail.clientWidth*.85,behavior:reducedMotion.matches?'instant':'smooth'});}));
rail.addEventListener('scroll',railState,{passive:true});new ResizeObserver(railState).observe(rail);railState();
rail.addEventListener('keydown',e=>{if(e.target!==rail||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();pauseFlow();const left=e.key==='Home'?0:e.key==='End'?rail.scrollWidth:rail.scrollLeft+(e.key==='ArrowRight'?1:-1)*rail.clientWidth*.85;rail.scrollTo({left,behavior:reducedMotion.matches?'instant':'smooth'});});
document.querySelectorAll('[data-deck]').forEach(b=>b.addEventListener('click',()=>{const tabs=[...document.querySelectorAll('[data-tab]')];const current=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');tabs[(current+Number(b.dataset.deck)+tabs.length)%tabs.length].click();}));
// Warm adjacent gallery assets without changing the currently displayed window.
Object.keys(screens).forEach(key=>{const img=new Image();img.src='/guide/assets/product/showcase/'+key+'.png';});

const rootStyle=getComputedStyle(document.documentElement);
const tokenNumber=name=>parseFloat(rootStyle.getPropertyValue(name));
// Slow native two-row flow. No cloned links and no wheel interception.
const flowToggle=document.querySelector('#flow-toggle');
let flowPaused=false,flowVisible=false,flowFrame=0,flowTime=0,flowX=0,flowDirection=1;
function stopFlow(){cancelAnimationFrame(flowFrame);flowFrame=0;flowTime=0;}
function canFlow(){return !flowPaused&&!reducedMotion.matches&&!document.hidden&&flowVisible&&!rail.matches(':hover')&&!rail.contains(document.activeElement);}
function runFlow(time){flowFrame=0;if(!canFlow())return;const dt=flowTime?Math.min(time-flowTime,50)/1000:0;flowTime=time;const max=rail.scrollWidth-rail.clientWidth;if(max>0){flowX+=flowDirection*tokenNumber('--atlas-marquee-speed')*dt;if(flowX>=max){flowX=max;flowDirection=-1;}if(flowX<=0){flowX=0;flowDirection=1;}rail.scrollLeft=flowX;}flowFrame=requestAnimationFrame(runFlow);}
function startFlow(){if(!flowFrame&&canFlow()){flowX=rail.scrollLeft;flowTime=0;flowFrame=requestAnimationFrame(runFlow);}}
function pauseFlow(){flowPaused=true;stopFlow();flowToggle.setAttribute('aria-pressed','true');flowToggle.setAttribute('aria-label','播放功能自动滚动');flowToggle.innerHTML=icon('play');}
flowToggle.addEventListener('click',()=>{if(!flowPaused)pauseFlow();else{flowPaused=false;flowToggle.setAttribute('aria-pressed','false');flowToggle.setAttribute('aria-label','暂停功能自动滚动');flowToggle.innerHTML=icon('pause');startFlow();}});
rail.addEventListener('pointerenter',stopFlow);rail.addEventListener('pointerleave',startFlow);rail.addEventListener('focusin',stopFlow);rail.addEventListener('focusout',()=>requestAnimationFrame(startFlow));rail.addEventListener('wheel',pauseFlow,{passive:true});rail.addEventListener('pointerdown',pauseFlow);
new IntersectionObserver(entries=>{flowVisible=entries[0].isIntersecting;if(flowVisible)startFlow();else stopFlow();},{threshold:.1}).observe(rail);
document.addEventListener('visibilitychange',()=>document.hidden?stopFlow():startFlow());reducedMotion.addEventListener('change',()=>{stopFlow();startFlow();});
// Fixed-box typing; the accessible label remains stable throughout.
const typing=document.querySelector('.typewriter-text'),pill=document.querySelector('.typewriter-pill');
const phrases=['记录每一笔交易的来龙去脉','用随记留下盘中的观察与反思','把代表性交易沉淀为案例','在周期复盘中找到下一步'];
let phrase=0,letters=Array.from(phrases[0]).length,deleting=true,typeTimer;
function stopTyping(){clearTimeout(typeTimer);}
function typeTick(){if(document.hidden||reducedMotion.matches||pill.matches(':hover')||pill.contains(document.activeElement))return;const chars=Array.from(phrases[phrase]);letters+=deleting?-1:1;typing.textContent=chars.slice(0,letters).join('');let delay=tokenNumber('--atlas-typewriter-key')*(deleting?.5:1);if(letters===0){deleting=false;phrase=(phrase+1)%phrases.length;delay=400;}else if(letters===chars.length){deleting=true;delay=tokenNumber('--atlas-typewriter-hold');}typeTimer=setTimeout(typeTick,delay);}
function startTyping(){stopTyping();if(!reducedMotion.matches&&!document.hidden)typeTimer=setTimeout(typeTick,tokenNumber('--atlas-typewriter-hold'));}
pill.addEventListener('pointerenter',stopTyping);pill.addEventListener('pointerleave',startTyping);pill.addEventListener('focusin',stopTyping);pill.addEventListener('focusout',startTyping);document.addEventListener('visibilitychange',()=>document.hidden?stopTyping():startTyping());reducedMotion.addEventListener('change',()=>{stopTyping();typing.textContent=phrases[0];phrase=0;letters=Array.from(phrases[0]).length;deleting=true;startTyping();});startTyping();

// Liquid Ether: same fluid engine family and configuration as the reference site.
const fluidHost=document.querySelector('.ambient-fluid');let disposeFluid=null,fluidGeneration=0;
function resolveCssColor(value){const probe=document.createElement('span');probe.style.color=value;document.documentElement.appendChild(probe);const resolved=getComputedStyle(probe).color;probe.remove();return resolved;}
async function syncFluid(){const generation=++fluidGeneration;if(disposeFluid){disposeFluid();disposeFluid=null;}fluidHost.replaceChildren();if(reducedMotion.matches)return;try{const {mountLiquidEther}=await import('./vendor/liquid-ether.js');if(generation!==fluidGeneration)return;const s=getComputedStyle(document.documentElement);const number=name=>parseFloat(s.getPropertyValue('--atlas-fluid-'+name));disposeFluid=mountLiquidEther(fluidHost,{visibilityGain:number('visibility'),mouseForce:number('force'),cursorSize:number('cursor'),viscous:number('viscosity'),resolution:number('resolution'),autoSpeed:number('speed'),autoIntensity:number('intensity'),autoResumeDelay:number('resume'),colors:[1,2,3].map(n=>resolveCssColor(s.getPropertyValue('--atlas-fluid-color-'+n).trim()))});}catch(error){fluidHost.replaceChildren();console.warn('背景流体不可用，保留静态背景。',error);}}
reducedMotion.addEventListener('change',syncFluid);window.addEventListener('pagehide',()=>{fluidGeneration++;disposeFluid?.();});window.addEventListener('pageshow',e=>{if(e.persisted)syncFluid();});syncFluid();

const sizeFluid=()=>{const windowTop=document.querySelector('.hero-window').offsetTop;fluidHost.style.height=windowTop+'px';};new ResizeObserver(sizeFluid).observe(document.querySelector('.hero'));sizeFluid();

const stageRecords=[
  {title:'XAUUSD',meta:'多 · 4H · 伦敦收盘 · 优秀范例',status:'已复盘',note:'价格回到观察区后等待收线确认，再按原定计划执行。保留了完整判断依据；确认之前仍有提前操作的倾向。',next:'下单前检查结构、确认与风险。缺少一项就继续等待。'},
  {title:'BTCUSDT',meta:'多 · 1H · 纽约盘 · 待复看',status:'待复盘',note:'入场前没有等待充分确认。下次先核对接交易条件，再考虑执行。',next:'把确认步骤写进计划，未完成前不下单。'},
  {title:'EURUSD',meta:'空 · 4H · 纽约盘 · 困惑盘面',status:'待复盘',note:'方向判断与执行条件不一致，先作为对照留下，等待之后重新理解。',next:'回看相似结构时，只比较当时写下的条件。'},
  {title:'XAUUSD',meta:'多 · 4H · 伦敦盘 · 优秀范例',status:'已复盘',note:'等待价格回到观察区域，确认之后执行，风险留在计划范围内。',next:'继续用同一份入场检查，不因结果改规则。'},
  {title:'GBPUSD',meta:'多 · 1H · 伦敦收盘 · 待复看',status:'待复盘',note:'记录执行偏差。结果不理想时，也保留完整的决策上下文。',next:'把偏差写回这笔，而不是只改下一笔的感觉。'},
  {title:'XAUUSD',meta:'空 · 4H · 伦敦盘 · 结构确认',status:'已复盘',note:'按预先写下的条件入场，离场后及时补上价格反应。',next:'同类结构先找确认，再决定是否跟随。'},
  {title:'EURUSD',meta:'多 · 4H · 纽约盘 · 待复看',status:'待复盘',note:'将本次交易留作对照，观察相似结构在不同情境下的差异。',next:'下次只复盘条件是否齐，不先看盈亏。'}
];
const stageFrame=document.querySelector('.hero-stage-frame');
const stageTitle=document.getElementById('stage-title');
const stageMeta=document.getElementById('stage-meta');
const stageNote=document.getElementById('stage-note');
const stageNext=document.getElementById('stage-next');
function selectStageRecord(index){
  const record=stageRecords[index];
  if(!record||!stageTitle)return;
  stageTitle.textContent=record.title;
  stageMeta.textContent=record.meta;
  stageNote.textContent=record.note;
  stageNext.textContent=record.next;
  const status=stageTitle.closest('.hero-stage-pane-head')?.querySelector('span');
  if(status)status.textContent=record.status;
  stageFrame.querySelectorAll('.hero-stage-main[data-view="journal"] [data-record]').forEach(row=>{
    const current=row.dataset.record===String(index);
    row.classList.toggle('is-current',current);
    if(row.hasAttribute('aria-current'))row.setAttribute('aria-current',current?'true':'false');
  });
}
function showStage(view){
  stageFrame.dataset.stageView=view;
  stageFrame.querySelectorAll('.hero-stage-main').forEach(pane=>{pane.hidden=pane.dataset.view!==view;});
  stageFrame.querySelectorAll('.hero-stage-nav > button[data-stage]:not([data-record])').forEach(button=>{
    if(button.dataset.stage===view)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
}
stageFrame.querySelectorAll('.hero-stage-nav > button[data-stage]').forEach(button=>{
  button.addEventListener('click',()=>{
    showStage(button.dataset.stage);
    if(button.dataset.record)selectStageRecord(Number(button.dataset.record));
  });
});
stageFrame.querySelectorAll('.hero-stage-main [data-record]').forEach(row=>{
  row.addEventListener('click',()=>{
    if(row.closest('.hero-stage-main')?.dataset.view==='journal')selectStageRecord(Number(row.dataset.record));
    row.closest('.hero-stage-list')?.querySelectorAll('[data-record]').forEach(item=>{
      item.classList.toggle('is-current',item===row);
      if(item.hasAttribute('aria-current'))item.setAttribute('aria-current',item===row?'true':'false');
    });
  });
});
