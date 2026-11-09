import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, Script} from 'node:vm';
import {render} from './report.mjs';

const oldId='2026-11-02T22-00-00.000Z', latestId='2026-11-04T22-00-00.000Z';
function run(id, ms) {
 return {id,commit:id===oldId?'a'.repeat(40):'b'.repeat(40),subject:id,host:'jack',cpu:'Intel',node:'24',method:'same method',
  started:id,updated:id,status:'complete',timeoutMs:600000,total:2,
  results:[{path:'demos/keep.ra',group:'examples',kind:'program',status:'ok',ms,workloadHash:'same'},
   {path:'demos/other.ra',group:'examples',kind:'program',status:'ok',ms,workloadHash:'other'}]};
}
async function page(search='') {
 const older=run(oldId,200), latest=run(latestId,5000);
 const entries=[older,latest].map(({results,...summary})=>summary);
 const data=new Map([['latest.json',latest],['history.json',entries],['runs/'+oldId+'.json',older],['runs/'+latestId+'.json',latest],['job.json',{exitCode:0,finished:'now'}]]);
 const errors=new Map(), elements=new Map(), requests=[];
 function element(key) {
  key=key.replace(/^#/,'');
  if(!elements.has(key)) elements.set(key,{value:'',innerHTML:'',textContent:'',hidden:true,disabled:false,
   open:false,showModal(){this.open=true;},close(){this.open=false;},
   listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});
  return elements.get(key);
 }
 let href='https://example.test/bench/'+search;
 const classes=new Set();
 const document={body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},hidden:false,querySelector:element,getElementById:element,querySelectorAll:()=>[]};
 const location={get href(){return href},get search(){return new URL(href).search},get pathname(){return new URL(href).pathname}};
 const listeners={},stack=[{href,state:null}];let index=0;
 const browserHistory={get state(){return stack[index].state;},
  replaceState(state,_title,url){href=String(url);stack[index]={href,state};},
  pushState(state,_title,url){href=String(url);stack.splice(++index);stack.push({href,state});},
  async back(){if(index){href=stack[--index].href;await listeners.popstate?.();}},
  async forward(){if(index+1<stack.length){href=stack[++index].href;await listeners.popstate?.();}}};
 const context=createContext({document,location,URL,URLSearchParams,console,setInterval(){},window:{history:browserHistory,addEventListener(name,fn){listeners[name]=fn;}},
  async fetch(path,options){requests.push({path,options});return {ok:!errors.has(path),status:errors.get(path)||200,json:async()=>structuredClone(data.get(path))};}});
 const html=render(latest,older), script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new Script(script).runInContext(context);
 // Wait for the page's own initial refresh, not a second synthetic load.
 for(let i=0;i<20&&element('refresh').disabled;i++)await new Promise(setImmediate);
 assert.equal(element('refresh').disabled,false);
 return {element,data,errors,requests,location,browserHistory,classes};
}

test('selecting a past run updates histogram, header, counters and rows',async()=>{
 const p=await page();
 assert.match(p.element('histogram').innerHTML,/Median 5.0 s/);
 p.element('run').value=oldId;
 await p.element('run').onchange();
 assert.match(p.element('histogram').innerHTML,/Median 200 ms/);
 assert.match(p.element('report-header').innerHTML,new RegExp(oldId));
 assert.match(p.element('rows').innerHTML,/200.0 ms/);
 assert(!p.element('rows').innerHTML.includes('5.00 s'));
 assert.match(p.element('cards').innerHTML,/2\/2/);
 assert.equal(new URL(p.location.href).searchParams.get('run'),oldId);
});

test('comparison selection keeps the displayed run and its histogram',async()=>{
 const p=await page();
 p.element('baseline').value=oldId;
 await p.element('baseline').onchange();
 assert.match(p.element('histogram').innerHTML,/Median 5.0 s/);
 assert.match(p.element('report-header').innerHTML,new RegExp(latestId));
 assert.match(p.element('rows').innerHTML,/\+2400.0%/);
});

test('Refresh reloads the selected run and preserves filters',async()=>{
 const p=await page('?run='+oldId+'&q=keep&status=ok');
 assert.match(p.element('histogram').innerHTML,/Median 200 ms/);
 p.data.set('runs/'+oldId+'.json',run(oldId,400));
 await p.element('refresh').onclick();
 assert.match(p.element('histogram').innerHTML,/Median 400 ms/);
 assert.match(p.element('rows').innerHTML,/keep.ra/);
 assert(!p.element('rows').innerHTML.includes('other.ra'));
 assert.equal(p.element('query').value,'keep');
 assert.equal(p.element('status').value,'ok');
 assert.equal(p.element('run').value,oldId);
 assert(p.requests.every(x=>x.options?.cache==='no-store'||x.path==='job.json'));
});

test('a failed reload shows the error and keeps the last valid report',async()=>{
 const p=await page();
 p.errors.set('latest.json',503);
 await p.element('refresh').onclick();
 assert.match(p.element('feedback').textContent,/HTTP 503/);
 assert.match(p.element('histogram').innerHTML,/Median 5.0 s/);
 assert.equal(p.element('refresh').disabled,false);
});

test('peak RSS compares short workloads and follows the selected baseline',async()=>{
 const p=await page();
 const latest=p.data.get('latest.json'),older=p.data.get('runs/'+oldId+'.json');
 latest.results[0]={...latest.results[0],ms:50,peakRssMiB:150};
 older.results[0]={...older.results[0],ms:40,peakRssMiB:100};
 await p.element('refresh').onclick();
 const row=p.element('rows').innerHTML.split('</tr>').find(x=>x.includes('keep.ra'));
 assert.match(row,/150.0 MiB/);
 assert.match(row,/100.0 MiB/);
 assert.match(row,/\+50.0%/);
 assert(!row.includes('+25.0%')); // Short timing samples remain excluded.
 p.element('run').value=oldId;
 await p.element('run').onchange();
 const oldRow=p.element('rows').innerHTML.split('</tr>').find(x=>x.includes('keep.ra'));
 assert.match(oldRow,/100.0 MiB/);
 assert(!oldRow.includes('+50.0%'));
});

test('memory changes exclude missing, invalid, failed and changed workloads',async()=>{
 const p=await page();
 const latest=p.data.get('latest.json'),older=p.data.get('runs/'+oldId+'.json');
 for(const patch of [{}, {peakRssMiB:0}, {peakRssMiB:-1}, {peakRssMiB:NaN},
  {peakRssMiB:Infinity}, {peakRssMiB:100,status:'timeout'},
  {peakRssMiB:100,workloadHash:'changed'}, {peakRssMiB:100,kind:'tests'}]){
  latest.results[0]={path:'demos/keep.ra',group:'examples',kind:'program',status:'ok',ms:200,workloadHash:'same',peakRssMiB:150};
  older.results[0]={...latest.results[0],peakRssMiB:undefined,...patch};
  await p.element('refresh').onclick();
  const row=p.element('rows').innerHTML.split('</tr>').find(x=>x.includes('keep.ra'));
  assert(!row.includes('+50.0%'));
  assert(!row.includes('NaN'));
  assert(!row.includes('Infinity'));
 }
 older.results[0]={...latest.results[0],peakRssMiB:100};
 older.cpu='different CPU';
 await p.element('refresh').onclick();
 assert(!p.element('rows').innerHTML.includes('+50.0%'));
});


test('opening a demo shows a modal and exposes its source',async()=>{
 const p=await page();
 let prevented=false;
 await p.element('rows').onclick({target:{dataset:{path:'demos/keep.ra'}},preventDefault(){prevented=true;}});
 const panel=p.element('detail');
 assert.equal(prevented,true);
 assert.equal(panel.open,true);
 assert(p.classes.has('detail-open'));
 assert.match(p.element('detail-content').innerHTML,/demos\/keep.ra/);
 assert.match(p.element('detail-content').innerHTML,new RegExp('https://github.com/kmmbvnr/rank/blob/'+'b'.repeat(40)+'/demos/keep.ra'));
});


test('Back closes the modal and Forward reopens it without losing filters',async()=>{
 const p=await page('?q=keep&status=ok');
 await p.element('rows').onclick({target:{dataset:{path:'demos/keep.ra'}},preventDefault(){}});
 assert.equal(new URL(p.location.href).hash,'#demo=demos%2Fkeep.ra');
 await p.browserHistory.back();
 assert.equal(p.element('detail').open,false);
 assert(!p.classes.has('detail-open'));
 assert.equal(new URL(p.location.href).searchParams.get('q'),'keep');
 await p.browserHistory.forward();
 assert.equal(p.element('detail').open,true);
});

test('close button and Escape consume the modal history entry',async()=>{
 const p=await page();
 for(const close of [()=>p.element('detail-close').onclick(),()=>p.element('detail').listeners.cancel({preventDefault(){}})]){
  await p.element('rows').onclick({target:{dataset:{path:'demos/keep.ra'}},preventDefault(){}});
  await close();
  assert.equal(p.element('detail').open,false);
  assert.equal(new URL(p.location.href).hash,'');
 }
});

test('a direct demo link closes in place instead of navigating away',async()=>{
 const p=await page('?q=keep#demo=demos%2Fkeep.ra');
 assert.equal(p.element('detail').open,true);
 await p.element('detail-close').onclick();
 assert.equal(p.element('detail').open,false);
 assert.equal(new URL(p.location.href).hash,'');
 assert.equal(new URL(p.location.href).searchParams.get('q'),'keep');
});
