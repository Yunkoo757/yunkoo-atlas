import {cpSync,copyFileSync,mkdirSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root,'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Invalid generated output path');
const guide = path.resolve(root,'../atlas-docs-site');
const copies = [];
for (const file of ['index.html','style.css','app.js','fluid-loader.js']) copies.push([path.join(root,file),file,false]);
for (const file of ['favicon.svg','inter-variable.woff2']) copies.push([path.join(root,'assets',file),'assets/'+file,false]);
copies.push([path.join(root,'vendor'),'vendor',true]);
for(const file of ['index.html','app.js','content.js','data.js','icons.js','product-shot.js','site-shell.js']) copies.push([path.join(guide,file),'guide/'+file,false]);
copies.push([path.join(guide,'styles'),'guide/styles',true]);
for(const file of ['favicon.svg','inter-variable.woff2']) copies.push([path.join(guide,'assets',file),'guide/assets/'+file,false]);
copies.push([path.join(guide,'assets/product'),'guide/assets/product',true]);
// Validate the complete source manifest before replacing an existing successful build.
for(const [source,,directory] of copies) {
  const stat = statSync(source);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Invalid website source: '+source);
}
rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
for(const [source,relative,directory] of copies) {
  const target = path.join(output,relative);
  mkdirSync(path.dirname(target),{recursive:true});
  if(directory) cpSync(source,target,{recursive:true});
  else copyFileSync(source,target);
}
console.log('Built standalone static website and /guide/ at',output);
