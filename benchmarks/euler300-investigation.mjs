import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME?pathToFileURL(process.env.RANK_BENCH_RUNTIME).href:new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',variant='original',input='15']=process.argv.slice(2);
assert(['reference','compiled'].includes(mode));
assert(['original','nocopy','eager','maximal','maximal-scalar','maximal-buckets','maximal-scalar-buckets','production'].includes(variant));
const n=Number(input);assert(Number.isInteger(n)&&n>=2&&n<=15);
let source=readFileSync(new URL(variant==='production'?'../demos/euler/300_proteinfolding.ra':`./experiments/euler300-${variant==='nocopy'||variant==='eager'?'original':variant}.ra`,import.meta.url),'utf8').replace('arg N integer = 15',`arg N integer = ${n}`);
if(variant==='nocopy')source=source.replace('Best max Cn copy','Best max Cn');
if(variant==='eager')source=source.replace("Ai' =",'Ai =');
const stages=[];
for(const marker of ['rem A contact map contained','Sz = 2 ** N','Best = array shape Sz fill 0','Cb = array shape Sz fill 0']) {
 const i=source.indexOf(marker);if(i>=0){stages.push(source.slice(0,i));source=source.slice(i);}
}
stages.push(source);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'}),timings=[],start=performance.now();
try {
 for(let i=0;i<stages.length;i++){
  const diagnostics=new RuntimeDiagnostics(),t=performance.now();
  if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(stages[i]));else runtime.execute(stages[i]);
  timings.push({stage:i,ms:performance.now()-t,...(process.env.DIAGNOSTICS?{diagnostics}:{})});
 }
 const answer=String(runtime.variables.get('Answer')),golden={5:'1.4375',8:'3.3203125',10:'4.6220703125',12:'5.994873046875',15:'8.0540771484375'}[n];
 if(golden)assert.equal(answer,golden);
 console.log(JSON.stringify({mode,variant,n,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,timings}));
}finally{runtime.dispose();}
