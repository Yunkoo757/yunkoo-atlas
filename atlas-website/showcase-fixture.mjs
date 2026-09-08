import {createDesktopVisualSnapshot} from '../scripts/fixtures/desktop-visual-seed.mjs';
export function createShowcaseSnapshot(){
 const s=createDesktopVisualSnapshot();
 s.profile={...s.profile,displayName:'Yunkoo · 示例',legacyCashCurrencyAssumption:null};
 s.trades=s.trades.slice(0,24).map((t,i)=>{
  const day=`2026-09-${String(1+i%5).padStart(2,'0')}`;
  const r=[1.6,-1,2.1,-.8,.5,-1,1.2,-.6][i%8];
  return {...t,deletedAt:undefined,ref:`TRD-${101+i}`,tradeKind:i>=16?'case':'live',liveStageId:s.currentLiveStageId,sourceTradeId:undefined,
   status:r>0?'win':'loss',pnl:Math.round(r*100),rMultiple:r,resultSource:'imported',cashCurrency:'USD',
   entry:t.entry,exit:t.exit,size:t.size,openedAt:day+'T08:30:00+08:00',closedAt:day+'T15:20:00+08:00',closedTradingDayKey:day,
   reviewStatus:i%4?'reviewed':'unreviewed',caseType:i%2?'exemplar':'ambiguous',masteryState:i%3?'recheck':'mastered',
   tags:i%2?['结构确认','按计划执行']:['等待复看'],mistakeTags:r<0?['提前进场']:[],
   note:'<h2>盘面与计划</h2><p>观察关键结构的回踩，等待收线确认后，再判断是否符合原定计划。</p><h2>执行记录</h2><p>入场前写明失效条件。持仓中记录价格反应，不因短期波动临时改变规则。</p><h2>复盘结论</h2><p>做得好：保留了完整的判断依据。待改进：确认之前仍有提前操作的倾向。</p><h2>下一次行动</h2><p>下单前检查结构、确认与风险三项；缺少一项就继续等待。</p>'};
 });
 s.starredIds=[s.trades[0].id,s.trades[16].id];
 const entries=[['本周复盘：把等待写进计划','<h2>本周观察</h2><p>几次不理想的执行，都发生在确认尚未完成的时候。问题不在于看不见机会，而在于太早作出决定。</p><h2>继续保持</h2><ul><li>盘前写下关键位置和失效条件。</li><li>离场后及时补充决策依据。</li></ul><h2>下周只改一件事</h2><p>等待信号收线确认。每次入场前，核对计划中的三项条件，并记录是否满足。</p>'],['盘中观察：确认之前，先记录','<p>价格接近观察区，先记录预期与失效条件，不急于操作。</p>'],['一次错过机会的反思','<p>错过后重新检查计划，区分合理放弃与执行犹豫。</p>'],['我的盘前检查清单','<ul><li>关键位置</li><li>入场确认</li><li>风险边界</li></ul>']];
 s.quickNotes=entries.map(([title,contentHtml],i)=>({id:`showcase-note-${i}`,title,titleMode:'manual',contentHtml,pinned:i===0,createdAt:'2026-09-01T09:00:00Z',updatedAt:`2026-09-0${5-i}T09:00:00Z`}));
 s.weeklyReviews=[{...s.weeklyReviews[0],id:'weekly-review:2026-08-31',weekStart:'2026-08-31',weekEnd:'2026-09-06',executionScore:4,riskScore:4,emotionScore:3,contentHtml:'<h2>一周回顾</h2><p>保持了按计划记录与复盘的习惯。提前确认仍是重复出现的问题，需要把等待落实到入场检查。</p>',commitmentText:'确认完成，再执行计划',commitmentCriteria:'每笔交易留下一份入场检查记录，缺少确认则继续等待。',highlightTradeIds:[s.trades[0].id],mistakeTradeIds:[s.trades[1].id],followUpTradeIds:[s.trades[2].id]}];
 return s;
}
