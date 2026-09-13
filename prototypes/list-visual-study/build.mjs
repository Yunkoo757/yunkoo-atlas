// Standalone, disposable visual study. No production routes or data mutations.
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as icons from 'lucide-react';
const dir=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const names=['ListTodo','BookOpen','Shuffle','ChartNoAxesCombined','CalendarDays','FlaskConical','Bookmark','TrendingUp','ArrowLeftRight','Files','Zap','Search','SquarePen','List','LayoutGrid','SlidersHorizontal','ChevronDown','MoreHorizontal','Plus','CircleCheck','CircleX','Copy','Star','ArrowLeft','ArrowRight','X','Check','Tag','PanelLeft'];
const svg=Object.fromEntries(names.map(n=>[n,renderToStaticMarkup(React.createElement(icons[n],{size:16,strokeWidth:1.75,'aria-hidden':true}))]));
const tokens=fs.readFileSync('src/styles/tokens.css','utf8');
const font=fs.readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').toString('base64');
const template=fs.readFileSync(path.join(dir,'template.html'),'utf8');
fs.writeFileSync(path.join(dir,'index.html'),template.replace('/* TOKENS */',tokens).replace('FONT_DATA',font).replace('/* ICONS */',JSON.stringify(svg)),'utf8');
console.log(path.join(dir,'index.html'));
