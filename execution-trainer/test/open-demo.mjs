import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { Store } = require('../model.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(),'execution-trainer-review-'));
const today = new Date();
let now = new Date(today); now.setDate(now.getDate()-7);
const store = new Store(path.join(data,'records'),()=>now);
const id = store.create({name:'复盘',target:100,daily:3});
for (const [day, count] of [3,3,3,0,3,3,6,2].entries()) {
  now = new Date(today); now.setDate(now.getDate()-7+day);
  for(let i=0;i<count;i++) store.complete(id);
}
const env={...process.env,EXECUTION_TRAINER_DATA:data}; delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[root],{env,detached:true,stdio:'ignore',windowsHide:false});
child.unref();
console.log(JSON.stringify({pid:child.pid,data,source:root}));
