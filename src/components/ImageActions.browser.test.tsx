import { createRoot } from 'react-dom/client'
import { ImageActions } from './ImageActions'
import { ImageLightbox } from './ImageLightbox'
import { useShortcutStore } from '@/store/shortcutStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
declare global { interface Window { __imageActionsTest: Promise<void> } }
async function waitFor(check:()=>boolean){for(let i=0;i<250;i++){if(check())return;await new Promise(r=>setTimeout(r,20))}throw new Error('UI expectation failed')}
function button(label:string){const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);if(!b)throw new Error('Missing '+label);return b}
window.__imageActionsTest=(async()=>{
 const bridge=window.journalBridge,root=createRoot(document.getElementById('root')!)
 const calls:string[]=[]
 try {
  window.journalBridge={isElectron:true,outputImage:async(action,bytes)=>{const blob=new Blob([new Uint8Array(bytes)],{type:'image/png'});const bitmap=await createImageBitmap(blob);if(bitmap.width!==32||bitmap.height!==24)throw new Error('Image resolution changed');calls.push(action);return true}} as NonNullable<Window['journalBridge']>
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;canvas.getContext('2d')!.fillRect(0,0,32,24)
  const src=canvas.toDataURL()
  root.render(<><img id="inline" src={src}/><ImageLightbox/><ImageActions/></>)
  await waitFor(()=>!!document.querySelector<HTMLImageElement>('#inline')?.naturalWidth)
  document.querySelector('#inline')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:40}))
  await waitFor(()=>!!document.querySelector('.ctx'))
  button('复制图片').click();await waitFor(()=>calls.length===1)
  document.querySelector('#inline')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:40}))
  await waitFor(()=>!!document.querySelector('.ctx'));button('查看大图').click()
  await waitFor(()=>!!document.querySelector('.img-lightbox-img.is-ready'))
  document.querySelector('.img-lightbox-viewport')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100}))
  await waitFor(()=>!!document.querySelector('.ctx'));button('复制图片').click();await waitFor(()=>calls.length===2)
  button('图片操作').click();await waitFor(()=>!!document.querySelector('.ctx'));button('另存为 PNG…').click();await waitFor(()=>calls.length===3)
  if(calls.join(',')!=='copy,copy,save')throw new Error('Wrong actions')
 }finally{root.unmount();useShortcutStore.getState().closeLightbox();window.journalBridge=bridge}
})()
