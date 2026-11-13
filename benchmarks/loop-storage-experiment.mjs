import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {prepare} from './experiments/loop-storage-prototypes.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const option=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const out=resolve(option('out')??'/private/tmp/rank-storage-prototypes');
const versions=(option('versions')??'current,pages,tierup,checkpoint,combined').split(',');
const hash=s=>createHash('sha256').update(s).digest('hex');
const demos={185:['185_numbermind',4640261571849533n],170:['170_pandigitalproducts',9857164023n],186:['186_connectedness',2325629n],166:['166_crisscross',7130034n]};
function synthetic(name,n=2000000){
 if(name==='late-long')return synthetic('late',20000000);
 if(name==='late-square')return {source:`I = 0\nX = 1\nfor I less ${n}\n X += 1\n if I equal ${n-3}\n  X *= X\n  X *= X\n  X *= X\n  X *= X\n  X *= X\n end\n I += 1\nend\nAnswer = X`,answer:BigInt(n-1)**32n+2n};
 if(name==='register'||name==='early'||name==='late'){
  const x=name==='early'?9007199254740991n-2n:name==='late'?9007199254740991n-BigInt(n)+3n:0n;
  return {source:`I = 0\nX = ${x}\nfor I less ${n}\n X += ${name==='register'?'I':'1'}\n I += 1\nend\nAnswer = X`,answer:name==='register'?BigInt(n)*(BigInt(n)-1n)/2n:x+BigInt(n)};
 }
 if(['short','long','phase'].includes(name)){
  const size=72000,rounds=name==='short'?5000:name==='long'?3:180;
  const limit=name==='short'?'1':name==='long'?String(size):`(R less 100 choose 1 ${size})`;
  return {source:`use sequences\nA = array shape ${size} fill 0\nfor R in 0 till ${rounds}\n Limit = ${limit}\n J = 0\n for J less Limit\n  A J += 1\n  J += 1\n end\n Scratch = tuple J\nend\nAnswer = A sum`,answer:BigInt(name==='short'?rounds:name==='long'?size*3:100+80*size)};
 }
 if(['sparse-local','sparse-scatter','sparse-many'].includes(name)){
  const rounds=name==='sparse-many'?2000:32,limit=name==='sparse-many'?1:4096;
  const index=name==='sparse-scatter'?'(J mod 256) * 4096':'J mod 64';
  return {source:`use sequences\nA = array shape 1048576 fill 0\nfor R in 0 till ${rounds}\n J = 0\n for J less ${limit}\n  A (${index}) += 1\n  J += 1\n end\n Scratch = tuple J\nend\nAnswer = A sum`,answer:BigInt(rounds*limit)};
 }
 if(name==='dense')return {source:'use sequences\nA = array shape 65536 fill 0\nR = 0\nfor R less 32\n for I in 0 till 65536\n  A I += I\n end\n R += 1\nend\nAnswer = A sum',answer:65536n*65535n/2n*32n};
 if(name==='cold')return {source:'use sequences\nA = array shape 65536 fill 0\n'+Array.from({length:80},(_,i)=>`J = 0\nfor J less 1\n A ${i} += 1\n J += 1\nend`).join('\n')+'\nAnswer = A sum',answer:80n};
 throw Error('Unknown workload '+name);
}
function sourceFor(name){
 if(demos[name]){const [id,answer]=demos[name],file=resolve(root,`demos/euler/${id}.ra`);return {source:readFileSync(file,'utf8'),file,answer};}
 return {...synthetic(name),file:resolve(root,'benchmarks/storage-synthetic.ra')};
}
async function runtime(version){return import(pathToFileURL(resolve(out,version,'index.js')));}
async function observe(version,source,options={}){
 const m=await runtime(version),d=new m.RuntimeDiagnostics(),output=[];
 const {cancelAfter,...runtimeOptions}=options;
 const r=new m.Interpreter(s=>output.push(s),{sourceId:'storage.ra',...runtimeOptions});
 const {withInterrupt}=await import(pathToFileURL(resolve(out,version,'interrupt.js')));
 let polls=0;const signal={length:1,load:()=>0,store:()=>{},wait:()=>{},exchange:()=>++polls>=cancelAfter?1:0};
 let value,error;
 try{
  try{value=d.run(()=>cancelAfter?withInterrupt(signal,()=>r.execute(source)):r.execute(source));}catch(e){error=e instanceof m.RankError?e.format():String(e);}
  return {state:{value:value===undefined?null:m.formatValue(value),error,output,variables:[...r.variables].map(([k,v])=>[k,m.formatValue(v)])},diagnostics:d};
 }finally{r.dispose();}
}
function semanticCases(){
 const cases=[];
 for(const n of [0,1,511,512,513,1024,1025,2200,8192,8193,17000])cases.push([`carry-${n}`,`J = 0\nfor J less ${n}\n J += 1\nend`]);
 cases.push(['carry-real','J = 0\nfor J less 512\n J += 1\n 0.5\nend']);
 for(const kind of ['register','early','late'])cases.push([kind,synthetic(kind,2200).source]);
 cases.push(['late-after-checkpoint',synthetic('late',17000).source]);
 cases.push(['late-square',synthetic('late-square',17000).source]);
 for(const op of ['+','-','*','//','mod'])for(const sign of [1,-1])cases.push(['promotion-'+op+'-'+sign,`J = 0\nX = 100000000\nY = 0\nfor J less 600\n Y = (X * X) ${op} (${sign} * X)\n J += 1\nend`]);
 for(const op of ['//','mod'])for(const a of [1,-1])for(const b of [1,-1])cases.push(['signed-wide-'+op+'-'+a+'-'+b,`J = 0\nX = 100000000\nY = 0\nfor J less 600\n Y = (${a} * (X * X + 3)) ${op} (${b} * 7)\n J += 1\nend`]);
 for(const end of [512,1024,1800])cases.push(['alias-'+end,`use sequences\nA = array shape 128 fill 0\nAlias = A\nJ = 0\nfor J less ${end}\n A (J mod 128) += 1\n J += 1\nend`]);
 cases.push(['readonly-alias',`use sequences\nA = array shape 128 fill 2\nB = A\nJ = 0\nfor J less 1800\n A (J mod 128) = B (J mod 128) + 1\n J += 1\nend`]);
 cases.push(['two-destinations',`use sequences\nA = array shape 128 fill 0\nB = A\nJ = 0\nfor J less 1800\n A (J mod 128) += 1\n B (J mod 128) += 2\n J += 1\nend`]);
 cases.push(['bounds-error','use sequences\nA = array shape 700 fill 0\nAlias = A\nJ = 0\nfor J less 800\n A J = J\n J += 1\nend']);
 cases.push(['division-error','J = 0\nX = 0\nfor J less 800\n X = 7 // (700 - J)\n J += 1\nend']);
 cases.push(['intermediate-overflow','J = 0\nX = 100000000\nY = 0\nfor J less 1800\n Y = (X * X) - (X * X)\n J += 1\nend']);
 cases.push(['late-intermediate-overflow','J = 0\nX = 1\nY = 0\nfor J less 1800\n if J equal 1750\n  X = 100000000\n end\n Y = (X * X) - (X * X)\n J += 1\nend']);
 cases.push(['wide-stored-cell','use sequences\nA = array shape 1800 fill 0\nA 1750 = 9007199254740995\nJ = 0\nX = 0\nfor J less 1800\n X += A J\n J += 1\nend']);
 cases.push(['real-stores','use sequences\nA = array shape 128 fill 0.5\nAlias = A\nJ = 0\nfor J less 1800\n A (J mod 128) += 0.25\n J += 1\nend']);
 cases.push(['bool-stores','use sequences\nA = array shape 128 fill false\nAlias = A\nJ = 0\nfor J less 1800\n A (J mod 128) = not (A (J mod 128))\n J += 1\nend']);
 cases.push(['break-fallback','J = 0\nfor J less 2000\n J += 1\n if J equal 700\n  break\n end\nend']);
 cases.push(['continue-fallback','J = 0\nX = 0\nfor J less 800\n J += 1\n if J mod 2 equal 0\n  continue\n end\n X += J\nend']);
 cases.push(['range-fallback','use sequences\nA = array shape 128 fill 0\nfor J in 0 till 1800\n A (J mod 128) += 1\nend']);
 cases.push(['vector-fallback','use sequences\nA = 0 till 1800 array\nTotal = 0\nfor V in A\n Total += V\nend']);
 cases.push(['nested-prefix','I = 0\nX = 0\nfor I less 1200\n for J in 0 till 4\n  X += I + J\n end\n I += 1\nend']);
 cases.push(['wide-update','use sequences\nA = array shape 128 fill 9007199254740000\nAlias = A\nJ = 0\nfor J less 1800\n A (J mod 128) += 1000\n J += 1\nend']);
 cases.push(['empty-shared','use sequences\nA = array shape 128 fill 2\nB = A\nJ = 0\nfor J less 0\n A 0 = 9\n J += 1\nend']);
 return cases;
}
if(option('prepare')){
 prepare(root,out,Number(option('chunk')??8192));
 console.log(JSON.stringify({out,chunk:Number(option('chunk')??8192)}));
}else if(option('verify')){
 const records=[];
 for(const [name,source] of semanticCases()){
  const ref=await observe('current',source,{compilation:false});
  for(const v of versions){const r=await observe(v,source);assert.deepEqual(r.state,ref.state,`${name}: ${v}`);records.push({name,version:v,passed:true,diagnostics:r.diagnostics});}
 }
 // Explicit host execution callbacks retain ordinary execution, once per Rank loop.
 for(const v of versions){let calls=0;const r=await observe(v,'J = 0\nfor J less 1800\n J += 1\nend',{onIntegerLoopExecuted:()=>calls++});assert.equal(calls,1);assert.equal(r.state.error,undefined);records.push({name:'host-callback',version:v,passed:true,calls});}
 const cancelSource='use sequences\nA = array shape 128 fill 0\nJ = 0\nfor J less 100000\n A (J mod 128) += 1\n J += 1\nend';
 const cancelled=await observe('current',cancelSource,{cancelAfter:3});assert(cancelled.state.error?.includes('Interrupted'));
 for(const v of versions){const r=await observe(v,cancelSource,{cancelAfter:3});assert.deepEqual(r.state,cancelled.state,v+': custom polling');records.push({name:'custom-polling',version:v,passed:true,diagnostics:r.diagnostics});}
 console.log(JSON.stringify({cases:semanticCases().length+2,versions,records},null,2));
}else if(option('worker')){
 const name=option('worker'),v=option('version'),m=await runtime(v),{source,file,answer}=sourceFor(name),d=new m.RuntimeDiagnostics(),output=[];
 const r=new m.Interpreter(s=>output.push(s),{sourceId:file,loadModule(spec,from){const id=resolve(dirname(from??file),spec.endsWith('.ra')?spec:spec+'.ra');return{id,source:readFileSync(id,'utf8')};}});
 try{const start=performance.now();if(option('diagnostics'))d.run(()=>r.execute(source));else r.execute(source);const ms=performance.now()-start,rssMiB=process.resourceUsage().maxRSS/1024;assert.equal((r.variables.get('Answer') ?? r.lastResult),answer);console.log(JSON.stringify({case:name,version:v,ms,rssMiB,sourceHash:hash(source),answer:String(answer),...(option('diagnostics')?{diagnostics:d}:{})}));}finally{r.dispose();}
}else{
 const cases=(option('cases')??'185,170,186,166,short,long,phase,sparse-local,sparse-scatter,sparse-many,dense,cold,register,early,late').split(',');
 const samples=Number(option('samples')??3),results=[],jobs=cases.flatMap(name=>versions.map(version=>({name,version})));
 assert(Number.isSafeInteger(samples)&&samples>0);
 for(let sample=0;sample<samples;sample++)for(const j of sample%2?[...jobs].reverse():jobs){
  const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--out=${out}`,`--worker=${j.name}`,`--version=${j.version}`,...option('diagnostics')?[`--diagnostics=true`]:[]],{encoding:'utf8',timeout:Number(option('deadline')??120000)});
  let r;if(p.error?.code==='ETIMEDOUT')r={case:j.name,version:j.version,timedOut:true};else{assert.ifError(p.error);assert.equal(p.status,0,p.stderr);r=JSON.parse(p.stdout);}
  results.push({sample,...r});process.stderr.write(JSON.stringify(results.at(-1))+'\n');
 }
 console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0].model,versions,samples,results},null,2));
}
