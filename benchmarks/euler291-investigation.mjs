import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled', variant='original', limit='100000000']=process.argv.slice(2);
const source=readFileSync(new URL(variant==='shipping'?'../demos/euler/291_panaitopolprimes.ra':`./experiments/euler291-${variant}.ra`,import.meta.url),'utf8').replace(/arg Limit integer = \d+/, `arg Limit integer = ${limit}`);
const runtime=new Interpreter(()=>{}, {compilation:mode==='compiled'});
const start=performance.now();
try {
 const parts=process.env.WHOLE ? [source] : source.split(/(?=^Small =|^Blk =|^Answer =)/m);
 for(let i=0;i<parts.length;i++) {
  const diagnostics=new RuntimeDiagnostics();const t=performance.now();
  if(process.env.DIAGNOSTICS) diagnostics.run(()=>runtime.execute(parts[i]));else runtime.execute(parts[i]);
  console.log(JSON.stringify({phase:i,ms:performance.now()-t,...(process.env.DIAGNOSTICS?{diagnostics}:{}),q:String(runtime.variables.get('Qn')),count:String(runtime.variables.get('Count'))}));
 }
 const expected={'5000000000000000':'4037526','1000000':'175','100000000':'1225','100000000000':'26516'}[limit];
 if(expected) assert.equal(String(runtime.variables.get('Answer')),expected);
 console.log(JSON.stringify({mode,variant,limit,probe:process.env.RANK291_PROBE??null,whole:!!process.env.WHOLE,ms:performance.now()-start,answer:String(runtime.variables.get('Answer')),rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{runtime.dispose();}
