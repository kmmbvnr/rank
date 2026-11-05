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
   listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});
  return elements.get(key);
 }
 let href='https://example.test/bench/'+search;
 const document={hidden:false,querySelector:element,getElementById:element,querySelectorAll:()=>[]};
 const location={get href(){return href},get search(){return new URL(href).search},get pathname(){return new URL(href).pathname}};
 const context=createContext({document,location,URL,URLSearchParams,console,setInterval(){},window:{history:{replaceState(_state,_title,url){href=String(url)}}},
  async fetch(path,options){requests.push({path,options});return {ok:!errors.has(path),status:errors.get(path)||200,json:async()=>structuredClone(data.get(path))};}});
 const html=render(latest,older), script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new Script(script).runInContext(context);
 // Wait for the page's own initial refresh, not a second synthetic load.
 for(let i=0;i<20&&element('refresh').disabled;i++)await new Promise(setImmediate);
 assert.equal(element('refresh').disabled,false);
 return {element,data,errors,requests,location};
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
