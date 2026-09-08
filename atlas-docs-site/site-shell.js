import {icon} from './icons.js';
export function siteHeader(active='home') {
  return `<header class="atlas-header"><div class="atlas-header-inner"><a class="atlas-brand" href="/" aria-label="Trader Atlas 首页"><img src="/guide/assets/favicon.svg" width="30" height="30" alt=""><span>Trader Atlas</span></a><nav aria-label="主导航"><a href="/#workflow">产品功能</a><a href="/#preview">软件预览</a><a href="/guide/" ${active==='guide'?'aria-current="page"':''}>使用指南</a></nav><a class="button secondary small atlas-download" href="/#download">获取 Trader Atlas ${icon('arrow','sm')}</a></div></header>`;
}
