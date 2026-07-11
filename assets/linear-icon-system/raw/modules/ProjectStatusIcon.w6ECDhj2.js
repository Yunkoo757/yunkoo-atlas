
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="74d7e044-2131-5284-b022-8e748b50396a")}catch(e){}}();
import{n as e,s as t}from"./rolldown-runtime.Cmlxbba-.js";import{NN as n,fg as r,jN as i,pg as a}from"./store.Cb-UhZ0r.js";import{n as o,t as s}from"./vendor-react.4CtHp4wB.js";import{B as c,i as l,z as u}from"./ThemeProvider.DeOmCkhs.js";import{p as d,t as f}from"./src.BcWTfVUc.js";import{r as p,t as m}from"./vendor-mobx-react-lite.DCRn5BPr.js";import{c as h,l as g}from"./EmojiContainer.CeAZEvLX.js";var _,v,y,b,x,S,C=e((()=>{_=t(o()),m(),c(),f(),n(),h(),a(),v=s(),y=p(function(e){let{className:t,overrideColor:n,dontAnimate:a}=e,o,s,c=0;if(`statusType`in e)o=e.statusType,c=.5;else if(`status`in e)s=e.status,o=e.status.type,c=e.status.progress||0;else{let t=e.project;s=t.status;let n=t.organization.projectStatusStartedCount===1;c=(t.persisted&&n?t.progress:s.progress)||0,o=s.type}let u=l(),d=g(n??s?.color??r.getDefaultColorForType(o,u)),f=a||!(`project`in e),p=0;switch(o){case i.started:p=c,`project`in e&&e.project.organization.projectStatusStartedCount===1&&(p=c*.7+.15);break;case i.completed:case i.canceled:p=1;break;default:p=0}let m=o===i.completed||o===i.canceled,h=`${o}_${d}_${p}`,y=_.useRef(h),C=y.current!==h&&!f;y.current=h;let w=_.useRef(m),T=!w.current&&m;w.current=m;let E=_.useId();return(0,v.jsxs)(b,{transition:C,width:16,height:16,viewBox:`-1 -1 16 16`,fill:`none`,stroke:`none`,className:t,children:[(0,v.jsx)(`path`,{d:`M2.95778 3.02069L5.70777 1.36023C6.50244 0.88041 7.49756 0.88041 8.29223 1.36024L11.0422 3.02074C11.7918 3.47336 12.25 4.2852 12.25 5.16086V8.84803C12.25 9.7251 11.7904 10.5381 11.0388 10.9902L8.29114 12.6433C7.49693 13.1211 6.50355 13.1203 5.71011 12.6412L2.95775 10.9792C2.20815 10.5266 1.75 9.7148 1.75 8.83911V5.16082C1.75 4.28516 2.20816 3.47332 2.95778 3.02069Z`,stroke:d,strokeWidth:`1.5`,strokeLinejoin:`bevel`,strokeDasharray:o===i.backlog?`1.65 1.35`:`3.14 0`,strokeDashoffset:o===i.backlog?2.3:1,fill:`none`}),(0,v.jsx)(`g`,{mask:`url(#${E}-hole-${p*100})`,children:(0,v.jsx)(`circle`,{r:`4`,cx:`7`,cy:`7`,stroke:d,fill:`none`,strokeWidth:`8`,strokeDasharray:`calc(${p*25.12}) 25.12`,transform:`rotate(-90) translate(-14, 0)`})}),(0,v.jsxs)(`mask`,{id:`${E}-hole-${p*100}`,maskUnits:`userSpaceOnUse`,children:[(0,v.jsx)(`path`,{transform:p===1?`translate(-7.5, -7.5) scale(1.8)`:`translate(-1, -1)`,d:`M8.3779 4.74233C8.14438 4.60607 7.85562 4.60607 7.6221 4.74233L5.37209 6.05513C5.14168 6.18957 5 6.4363 5 6.70311V9.34216C5 9.60897 5.14168 9.85573 5.37209 9.99016L7.6221 11.303C7.85562 11.4392 8.14438 11.4392 8.3779 11.303L10.6279 9.99016C10.8583 9.85573 11 9.60897 11 9.34216V6.70311C11 6.4363 10.8583 6.18957 10.6279 6.05513L8.3779 4.74233Z`,fill:`white`}),m&&(0,v.jsx)(`path`,{className:T?`animate`:void 0,stroke:`none`,fill:`black`,d:o===i.completed?x:S})]})]})}),b=u.svg([`& .icon{fill:`,`;}`,``],e=>e.theme.baseTheme?.color.bgBase||e.theme.color.bgBase,e=>e.transition&&`& circle {
       transition: all ${d(`slowTransition`)};
     }

     & path {
       transition: all ${d(`slowTransition`)};
     }

     & .animate {
       transform-origin: center;
       animation: scale ${d(`slowTransition`)} cubic-bezier(0.5, 1.4, 0.4, 1) 0.25s both;
     }

		 & .progress {
      transition-property: stroke, stroke-width;
     }

     @keyframes scale {
       0% {
         scale: 0.5;
         opacity: 0;
       }
       100% {
         scale: 1;
         opacity: 1;
       }
    }`),x=`M10.7803 5.28033C11.0732 4.98744 11.0732 4.51256 10.7803 4.21967C10.4874 3.92678 10.0126 3.92678 9.7197 4.21967L5.75 8.18934L4.28033 6.71967C3.98744 6.42678 3.51256 6.42678 3.21967 6.71967C2.92678 7.01256 2.92678 7.48744 3.21967 7.78033L5.21967 9.7803C5.51256 10.0732 5.98744 10.0732 6.28033 9.7803L10.7803 5.28033Z`,S=`M3.73657 3.73657C4.05199 3.42114 4.56339 3.42114 4.87881 3.73657L5.93941 4.79716L7 5.85775L9.12117 3.73657C9.4366 3.42114 9.94801 3.42114 10.2634 3.73657C10.5789 4.05199 10.5789 4.56339 10.2634 4.87881L8.14225 7L10.2634 9.12118C10.5789 9.4366 10.5789 9.94801 10.2634 10.2634C9.94801 10.5789 9.4366 10.5789 9.12117 10.2634L7 8.14225L4.87881 10.2634C4.56339 10.5789 4.05199 10.5789 3.73657 10.2634C3.42114 9.94801 3.42114 9.4366 3.73657 9.12118L4.79716 8.06059L5.85775 7L3.73657 4.87881C3.42114 4.56339 3.42114 4.05199 3.73657 3.73657Z`}));export{C as n,y as t};
//# debugId=74d7e044-2131-5284-b022-8e748b50396a
