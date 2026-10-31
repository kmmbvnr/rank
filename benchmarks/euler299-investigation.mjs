import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME
 ? pathToFileURL(process.env.RANK_BENCH_RUNTIME).href
 : new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',variant='original',limit='100000000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode)&&/^[a-z]+$/.test(variant)&&/^\d+$/.test(limit));
const source=readFileSync(new URL(variant==='original'?'../demos/euler/299_threesimilar.ra':`./experiments/euler299-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 100000000',`arg Limit integer = ${limit}`);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'}),d=new RuntimeDiagnostics(),start=performance.now();
try{if(process.env.DIAGNOSTICS)d.run(()=>runtime.execute(source));else runtime.execute(source);
const answer=String(runtime.variables.get('Answer')),expected={100:'92',100000:'320471',100000000:'549936643'}[limit];if(expected)assert.equal(answer,expected);
console.log(JSON.stringify({mode,variant,limit,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{runtime.dispose();}
