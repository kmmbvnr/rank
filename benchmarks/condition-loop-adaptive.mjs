// Build first; versions run serially in fresh processes. Diagnostics are separate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
const root=fileURLToPath(new URL('..',import.meta.url));
const option=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const hash=s=>createHash('sha256').update(s).digest('hex');
const demos={185:['185_numbermind','4640261571849533'],170:['170_pandigitalproducts','9857164023'],179:['179_consecutivedivisors','986262'],23:['023_abundantsums','4179871'],125:['125_palindromicsums','2906969179'],166:['166_crisscross','7130034'],177:['177_quadrilaterals','129325'],60:['060_primepairs','26033'],88:['088_productsum_stack','7587457'],186:['186_connectedness','2325629']};
function synthetic(name){
 if(name==='slice') {
  const N=72000, stack=new Array(N+1).fill(0);let tp=0;
  for(let j=0;j<N;j++){stack[tp++]=j%7;let go=true;while(go&&tp>=2){if(stack[tp-1]>stack[tp-2]){stack[tp-2]=stack[tp-1];tp--;}else go=false;}}
  return {expected:String(tp),source:`use sequences
N = ${N}
St = array shape (N + 1) fill 0
Sa = St (0 till 0)
Tp = 0
for J in 0 till N
 if J equal 36000
  Sa = St (0 till Tp)
 end
 St Tp = J mod 7
 Tp += 1
 Go = true
 for Go and Tp at least 2
  if St (Tp - 1) greater St (Tp - 2)
   St (Tp - 2) = St (Tp - 1)
   Tp -= 1
  else
   Go = false
  end
 end
end
Answer = Tp`};
 }
 const rounds=5000,size=72000;
 const limit=name==='long'?String(size):name==='phase'?`(R less 100 choose 1 ${size})`:'1';
 const n=name==='long'?3:name==='phase'?180:rounds;
 return {source:`use sequences
A = array shape ${size} fill 0
for R in 0 till ${n}
 Limit = ${limit}
 J = 0
 for J less Limit
  A J += 1
  J += 1
 end
 Scratch = tuple J
end
Answer = A sum`, expected:name==='long'?String(size*n):name==='phase'?String(100+80*size):String(rounds)};
}
if(option('worker')){
 const name=option('worker'),runtime=resolve(option('runtime'));
 const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(runtime));
 const tuple=demos[name.replace('-test','')];
 assert(tuple || ['short','long','phase','slice'].includes(name), `Unknown benchmark case: ${name}`);
 let file=tuple?resolve(root,`demos/euler/${tuple[0]}${name.endsWith('-test')?'_test':''}.ra`):resolve(root,'benchmarks/synthetic.ra');
 const {source,expected}=tuple?{source:readFileSync(file,'utf8'),expected:tuple[1]}:synthetic(name);
 const d=new RuntimeDiagnostics(),output=[];
 const r=new Interpreter(s=>output.push(s),{testing:true,compilation:option('engine')!=='reference',sourceId:file,loadModule(spec,from){const id=resolve(dirname(from??file),spec.endsWith('.ra')?spec:spec+'.ra');return{id,source:readFileSync(id,'utf8')};}});
 try{
  const start=performance.now();
  if(option('diagnostics'))d.run(()=>r.execute(source));else r.execute(source);
  const ms=performance.now()-start,rssMiB=process.resourceUsage().maxRSS/1024;
  if(name.endsWith('-test')){assert(r.testResults.length>0);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));}
  else assert.equal(r.variables.get('Answer'),BigInt(expected));
  console.log(JSON.stringify({case:name,version:option('version'),ms,rssMiB,sourceHash:hash(source),answer:String(r.variables.get('Answer')),tests:r.testResults.map(({name,passed})=>({name,passed})),...(option('diagnostics')?{diagnostics:d}:{})}));
 }finally{r.dispose();}
}else{
 const selected=option('versions')?.split(',')??['before','fixed','adaptive'];
 assert(selected.length && new Set(selected).size===selected.length);
 const reserved=['worker','runtime','diagnostics','engine','samples','cases','versions'];
 for(const v of selected) assert(!reserved.includes(v), `Reserved version label: ${v}`);
 const samples=Number(option('samples')??3);
 assert(Number.isSafeInteger(samples) && samples>0);
 for(const v of selected) assert(option(v), `Provide --${v}=/path/to/runtime/index.js`);
 const versions=Object.fromEntries(selected.map(v=>[v,resolve(option(v))]));
 const cases=(option('cases')??'185,185-test,170,179,23,125,166,177,60,88,186,short,long,phase,slice').split(',');
 const jobs=cases.flatMap(name=>Object.entries(versions).filter(([v])=>!option('versions')||option('versions').split(',').includes(v)).map(([version,runtime])=>({name,version,runtime})));
 const results=[];
 for(let sample=0;sample<samples;sample++)for(const j of sample%2?[...jobs].reverse():jobs){
  const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--worker=${j.name}`,`--version=${j.version}`,`--runtime=${j.runtime}`,...['diagnostics','engine'].flatMap(n=>option(n)?[`--${n}=${option(n)}`]:[])],{encoding:'utf8',timeout:60000});
  let result;
  if(p.error?.code==='ETIMEDOUT')result={case:j.name,version:j.version,timedOut:true};
  else{assert.ifError(p.error);assert.equal(p.status,0,p.stderr);result=JSON.parse(p.stdout);}
  result.sample=sample;results.push(result);process.stderr.write(JSON.stringify(result)+'\n');
 }
 console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,engine:option('engine')??'compiled',diagnostics:!!option('diagnostics'),versions:Object.fromEntries(Object.entries(versions).map(([v,p])=>[v,{path:p,hash:hash(readFileSync(resolve(dirname(p),'number-loop-runtime.js')))}])),results},null,2));
}
