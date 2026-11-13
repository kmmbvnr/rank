import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {Interpreter,RuntimeDiagnostics,formatValue,RankError} from '../../packages/interpreter/out/index.js';
const limits=[1,2,3,5,50,100,119,120,199,200,201,250,500,1000];
function brute(limit){
 let answer=0;
 for(let w=1;w<limit;w++){
  const hs=[];
  for(let x=w+1;x<limit;x++){const h=Math.sqrt(x*x-w*w);if(Number.isInteger(h))hs.push(h);}
  for(let i=1;i<hs.length;i++)for(let j=0;j<i;j++)if(hs[i]*hs[j]%(hs[i]+hs[j])===0)answer++;
 }
 return answer;
}
const answers=limits.map(brute);let checked=0;
for(const compilation of [false,true])for(const variant of ['original','production'])for(let i=0;i<limits.length;i++){
 const source=readFileSync(new URL(variant==='original'?'./euler309-original.ra':'../../demos/euler/309_ladders.ra',import.meta.url),'utf8').replace('arg Limit integer = 1000000',`arg Limit integer = ${limits[i]}`);
 const r=new Interpreter(()=>{},{compilation});try{r.execute(source);assert.equal(String((r.variables.get('Answer') ?? r.lastResult)),String(answers[i]));checked++;}finally{r.dispose();}
}
for(const compilation of [false,true]){
 const file=new URL('../../demos/euler/309_ladders_test.ra',import.meta.url).pathname;
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:file,loadModule(specifier,from){const id=resolve(dirname(from??file),specifier.endsWith('.ra')?specifier:specifier+'.ra');return {id,source:readFileSync(id,'utf8')};}});
 try{r.execute(readFileSync(file,'utf8'));assert.equal(r.testResults.length,6);assert(r.testResults.every(x=>x.passed),JSON.stringify(r.testResults));checked+=6;}finally{r.dispose();}
}
let compared=0;
for(const seeded of [false,true])for(const failure of ['overflow','error']){
 const source=`use algo
use numbers
Cache = new index
Alias = Cache
Other = new index
${seeded?'Cache -1 = 77\nOther -2 = 88':''}
A = array 0 0 0
Done = 0
for I in 0 to 2
 Cache I 0 = I
 Alias I 0 += 1
 Other (-I) = I + 10
 A I += 1
 Done += I gcd 2
 ${failure==='overflow'?'Wide = 9007199254740991 + I':'if I equal 2\n  Bad = Cache 999\n end'}
end`;
 function run(mode){
  const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',scalarEntryCompilation:false}),d=new RuntimeDiagnostics();let error;
  try{d.run(()=>r.execute(source));}catch(e){error=e instanceof RankError?e.format():String(e);}
  const state={error,variables:[...r.variables].map(([k,v])=>[k,v?.kind==='index'?[...v.entries].map(([k,v])=>[k,formatValue(v)]):formatValue(v)])};r.dispose();return {state,d};
 }
 const result=run('number');assert.deepEqual(result.state,run('exact').state);assert.deepEqual(result.state,run('reference').state);assert(result.d.numberLoops>0);if(failure==='overflow')assert(result.d.numberLoopOverflows>0);compared+=2;
}
let hookChecks=0;
for(const mode of ['number','exact','reference']){
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',scalarEntryCompilation:false}),d=new RuntimeDiagnostics();
 try{
  r.execute('use algo\nCache = new index');
  const cache=r.variables.get('Cache');
  cache.entries.clear=()=>{throw Error('host clear');};
  Object.defineProperty(cache.entries,'size',{get(){throw Error('host size');}});
  d.run(()=>r.execute('for I in 0 to 1\n Cache I = I\n Cache I += 1\n Wide = 9007199254740991 + I\nend'));
  assert.equal(cache.entries.get(0),1n);assert.equal(cache.entries.get(1),2n);
  if(mode==='number')assert(d.numberLoopOverflows>0);hookChecks++;
 }finally{r.dispose();}
}
const summary={node:process.version,arch:process.arch,smallAndFixtureChecks:checked,transactionComparisons:compared,hookChecks,answers};console.log(JSON.stringify(summary));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(summary,null,2)+'\n');
