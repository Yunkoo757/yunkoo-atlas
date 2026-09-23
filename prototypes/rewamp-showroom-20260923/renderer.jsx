import React, {Suspense, useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {categories} from './src/components/docsRegistry';
import './src/index.css';
import patches from './atlas-patches';
import Folder from './src/components/ui/FolderTabCard';
import {PerspectiveFlipDeck} from './src/components/ui/PerspectiveFlipDeck';
import {DiagonalCardStack} from './src/components/ui/DiagonalCardStack';
import {OrbitalCardArch} from './src/components/ui/OrbitalCardArch';
import {Editorial3DOrbitCarousel} from './src/components/ui/Editorial3DOrbitCarousel';
import ArchCardCarousel from './src/components/ui/ArchCardCarousel';
import {KineticLensSidebar} from './src/components/ui/KineticLensSidebar';
import {MorphSearchCapsule} from './src/components/ui/MorphSearchCapsule';
import AnimatedSearchDemo from './src/components/ui/AnimatedSearchDemo';

const config=window.__ATLAS_DEMO_CONFIG__||{slug:'folder-tab-card',mode:'atlas',theme:'dark'};
document.documentElement.classList.toggle('dark',config.theme!=='light');
document.documentElement.dataset.theme=config.theme||'dark';
const entry=categories.flatMap(g=>g.components).find(c=>c.slug===config.slug);
const group=categories.find(g=>g.components.some(c=>c.slug===config.slug))?.id;
const theme=config.theme==='light'?'light':'dark';
const dark=theme==='dark';
const color=dark?'#d8d8df':'#333340';
const smallButton={border:'1px solid '+(dark?'#35333f':'#d0cbd7'),borderRadius:6,padding:'6px 12px',background:dark?'#24222d':'#fff',color,cursor:'pointer',fontSize:13};

// Synthetic chart thumbnails are local SVG fixtures, not market data or screenshots.
function chart(i){
 const names=['EURUSD · 4H','EURUSD · 15M','EURUSD · 1M','GBPUSD · 4H','GBPUSD · 15M','XAUUSD · 1H','AUDUSD · 4H','XAUUSD · 15M'];
 let candles='';
 for(let j=0;j<28;j++){const base=190-28*Math.sin(j*.4+i)-j*1.5;const up=(j+i)%3!==0;const c=up?'#76b59a':'#bc7b85';candles+=`<path d="M${24+j*13} ${base-16}v42" stroke="${c}"/><rect x="${20+j*13}" y="${base}" width="8" height="${up?15:22}" fill="${c}"/>`;}
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300" viewBox="0 0 420 300"><rect width="420" height="300" fill="#14161b"/><path d="M20 100H400M20 150H400M20 200H400M20 250H400" stroke="#262933"/><text x="20" y="34" font-family="Arial" fill="#ededf0" font-size="18">${names[i%8]}</text><text x="20" y="57" font-family="Arial" fill="#92949f" font-size="11">ATLAS / SAMPLE ${String(i+1).padStart(2,'0')}</text><rect x="200" y="175" width="185" height="33" fill="#5e6ad2" opacity=".18"/><path d="M200 175H385" stroke="#7785e8" stroke-dasharray="4 4"/>${candles}<text x="20" y="283" font-family="Arial" fill="#92949f" font-size="11">SIMULATED REVIEW CHART / NOT MARKET DATA</text></svg>`;
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
const cards=Array.from({length:8},(_,i)=>({id:String(i+1),image:chart(i),title:['背景','对齐','触发','失效'][i%4],brand:'Atlas',badge:String(i+1)}));
const modules=['今日工作台','交易日志','案例记录','周复盘','复盘会话','仪表盘','策略管理','历史实盘','设置'].map((label,i)=>({id:String(i),label}));

function AtlasContent(){
 const [open,setOpen]=useState(false),[stacked,setStacked]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState('交易日志');
 const P=patches[config.slug];
 if(P)return <P/>;
 switch(config.slug){
  case 'folder-tab-card':return <div style={{height:'100%',width:'100%',display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}}>{open?<div style={{width:'min(94%,740px)',padding:24,border:'1px solid '+(dark?'#35333f':'#d0cbd7'),borderRadius:24,background:dark?'#17151e':'#fff'}}><button style={smallButton} onClick={()=>setOpen(false)}>← 返回集合</button><h2 style={{fontSize:20,margin:'16px 0'}}>等待回踩后的执行</h2><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12}}>{cards.slice(0,6).map(c=><img key={c.id} src={c.image} style={{width:'100%',borderRadius:12}}/>)}</div></div>:<div style={{width:330,height:420}}><Folder title="等待回踩" subtitle="复盘案例集合" tagsCount="12" tagsLabel="条案例" shotsCount="36 张截图" onAction={()=>setOpen(true)}/></div>}</div>;
  case 'perspective-flip-deck':return <PerspectiveFlipDeck items={cards} autoPlay={true}/>;
  case 'diagonal-card-stack':return <div style={{width:'100%'}}><DiagonalCardStack cards={cards} isStacked={stacked} onCardClick={()=>setStacked(v=>!v)}/><div style={{textAlign:'center'}}><button style={smallButton} onClick={()=>setStacked(v=>!v)}>{stacked?'展开复盘图':'收拢复盘图'}</button></div></div>;
  case 'orbital-card-arch':return <div style={{width:'100%'}}><OrbitalCardArch cards={cards} isStacked={stacked} onCardClick={()=>setStacked(v=>!v)}/><div style={{textAlign:'center'}}><button style={smallButton} onClick={()=>setStacked(v=>!v)}>{stacked?'展开案例':'收拢案例'}</button></div></div>;
  case 'editorial-3-d-orbit-carousel':return <Editorial3DOrbitCarousel items={cards}/>;
  case 'arch-card-carousel':return <ArchCardCarousel images={cards.map(c=>c.image)}/>;
  case 'kinetic-lens-sidebar':return <div style={{display:'grid',gridTemplateColumns:'minmax(0,420px) minmax(0,1fr)',width:'100%',alignItems:'center',gap:24,padding:24}}><KineticLensSidebar items={modules} autoCycle={false} onSelect={item=>setActive(item.label)} className="w-full"/><div style={{borderLeft:'1px solid '+(dark?'#35333f':'#d0cbd7'),padding:24}}><p style={{fontSize:12,opacity:.6}}>示例选中内容</p><h2 style={{fontSize:22,marginTop:12}}>{active}</h2></div></div>;
  case 'morph-search-capsule':return <div style={{width:'100%',textAlign:'center'}}><MorphSearchCapsule placeholder="搜索案例、品种或复盘笔记…" onSearch={setQuery}/><p style={{fontSize:12,marginTop:24,color}}>{query?'示例查询：'+query:'输入内容体验形变，不查询真实资料库'}</p></div>;
  case 'animated-search-demo':return <div style={{width:'100%',textAlign:'center'}}><AnimatedSearchDemo placeholder="搜索交易日志…" onSearch={setQuery}/>{query&&<p style={{fontSize:12,color}}>示例查询：{query}</p>}</div>;
  default:return <entry.Component/>;
 }
}
class Boundary extends React.Component{constructor(p){super(p);this.state={error:null}}static getDerivedStateFromError(error){return{error}}componentDidCatch(error){window.parent.postMessage({kind:'rewamp-error',slug:config.slug,error:String(error)},'*')}render(){return this.state.error?<pre style={{whiteSpace:'pre-wrap',padding:24,color:'#bc7b85'}}>该原版组件运行失败：{String(this.state.error)}</pre>:this.props.children}}
function App(){
 useEffect(()=>{window.parent.postMessage({kind:'rewamp-ready',slug:config.slug},'*')},[]);
 const isAtlas=config.mode==='atlas';
 return <div style={{minHeight:'100vh',height:'100vh',display:'flex',flexDirection:'column',background:dark?'#121116':'#f3f2f6',color,overflow:'hidden'}}>
  {isAtlas&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 20px',borderBottom:'1px solid '+(dark?'#292732':'#dedce5'),fontFamily:'Inter,system-ui,sans-serif',fontSize:12,flexShrink:0}}><span>Atlas　/　{config.scene||'组件场景'}</span><span style={{opacity:.6}}>模拟内容 · 保留 Rewamp 动效与材质</span></div>}
  <div data-demo-stage style={{flex:1,minHeight:0,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',isolation:'isolate',overflow:'auto'}}><Boundary><Suspense fallback={<div>正在加载组件…</div>}>{isAtlas?<AtlasContent/>:<entry.Component/>}</Suspense></Boundary></div>
 </div>
}
createRoot(document.getElementById('root')).render(<App/>);
