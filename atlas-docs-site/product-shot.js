const titles={cases:'案例库',board:'案例看板',notes:'随记',journal:'交易日志',detail:'单笔复盘',stats:'统计分析',period:'周期复盘',random:'随机复盘'};
// Source-pixel viewports; preserve the lossless originals and a stable 16:9 layout.
const crops={notes:[1580,170,2640],detail:[780,150,3300],random:[1400,970,2160],period:[1100,980,2800],stats:[760,150,3500]};
const stageCrops={journal:[200,0,3920]};
class ProductShot extends HTMLElement {
 static observedAttributes=['view','framing'];
 constructor(){super();this.attachShadow({mode:'open'});}
 connectedCallback(){this.render();}
 attributeChangedCallback(){if(this.isConnected)this.render();}
 render(){
  const key=this.getAttribute('view')||'cases';if(!titles[key])return;
  const framing=this.getAttribute('framing');
  const cropped=framing==='focus'||framing==='stage';
  const [x,y,width]=framing==='stage'&&stageCrops[key]?stageCrops[key]:crops[key]||[740,24,3540];
  const height=width*9/16;
  const src=new URL('assets/product/showcase/'+key+'.png',import.meta.url).href;
  const position=cropped?`position:absolute;width:${4320/width*100}%;max-width:none;left:${-x/width*100}%;top:${-y/height*100}%;`:'';
  const ratio=framing==='stage'||framing==='focus'?'var(--atlas-shot-focus-ratio,16/9)':'3/2';
  this.shadowRoot.innerHTML=`<style>:host{display:block;position:relative;aspect-ratio:${ratio};overflow:hidden;border-radius:var(--atlas-radius-media);background:var(--atlas-bg)}img{display:block;width:100%;height:auto;pointer-events:none;user-select:none;-webkit-user-drag:none;${position}}</style><img src="${src}" alt="Trader Atlas ${titles[key]}${cropped?'界面局部':'完整工作台'} · Yunkoo 示例资料库" width="4320" height="2880" draggable="false" loading="${this.hasAttribute('eager')?'eager':'lazy'}">`;
 }
}
customElements.define('product-shot',ProductShot);
