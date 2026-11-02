import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK346_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [name='split',mode='compiled']=process.argv.slice(2);
let source=readFileSync(new URL(`experiments/euler346-${name}.ra`,import.meta.url),'utf8');
source=source.slice(0,name==='original'?source.indexOf('\nAnswer ='):source.lastIndexOf('\nLimit strong print'));
const outputs=[];const r=new Interpreter(t=>outputs.push(t.trim()),{compilation:mode!=='reference'});
try{
 r.execute(source+'\nfun solve\n  return 1000000000000 strong\nend');
 const samples=[];
 for(let i=0;i<5;i++) {const t=performance.now();r.execute('solve print');samples.push(performance.now()-t);assert.equal(outputs.at(-1),'336108797689259276');}
 console.log(JSON.stringify({name,mode,ms:samples,rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{r.dispose();}
