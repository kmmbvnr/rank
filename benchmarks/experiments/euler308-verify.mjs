import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const original=readFileSync('benchmarks/experiments/euler308-original.ra','utf8');
function source(variant,target){
 let s=(['production','fallback'].includes(variant) ? readFileSync('demos/euler/308_automaton.ra','utf8') : original).replace('arg Target integer = 10001',`arg Target integer = ${target}`);
 if(variant==='inline')s=s.replace("  Old = Spf Ix\n  Free' = Ix filter Old equal 0 array",'  Free = Ix filter (Spf Ix) equal 0 array');
 if(variant==='native')s=s.slice(0,s.indexOf('Spf ='))+'Spf = Top factorsieve\n'+s.slice(s.indexOf('Start ='));
 if(variant==='fallback')s=s.replace('1048575','3');
 return s;
}
// Direct FRACTRAN simulation: no factor sieve or grouped floor sums.
const fractions=[[17,91],[78,85],[19,51],[23,38],[29,33],[77,29],[95,23],[77,19],[1,17],[11,13],[13,11],[15,2],[1,7],[55,1]].map(p=>p.map(BigInt));
let state=2n,step=0;const answers=[];
while(answers.length<16){
 for(const [a,b] of fractions)if(state%b===0n){state=state/b*a;break;}
 step++;
 if((state&(state-1n))===0n)answers.push(String(step));
 if(step>1000000)throw Error('FRACTRAN oracle budget');
}
assert.equal(answers[0],'19');assert.equal(answers[9],'36981');
let checked=0;
for(const compilation of [false,true])for(const variant of ['original','inline','native','production','fallback'])for(let i=0;i<answers.length;i++){
 const r=new Interpreter(()=>{},{compilation});
 try{r.execute(source(variant,i+1));assert.equal(String((r.variables.get('Answer') ?? r.lastResult)),answers[i],JSON.stringify({compilation,variant,target:i+1}));checked++;}finally{r.dispose();}
}
for(const compilation of [false,true]){
 const file=resolve('demos/euler/308_automaton_test.ra');
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:file,loadModule(specifier,from){
  const id=resolve(dirname(from??file),specifier.endsWith('.ra')?specifier:specifier+'.ra');
  return {id,source:readFileSync(id,'utf8')};
 }});
 try{r.execute(readFileSync(file,'utf8'));assert.equal(r.testResults.length,2);assert(r.testResults.every(x=>x.passed),JSON.stringify(r.testResults));checked+=2;}finally{r.dispose();}
}
writeFileSync('benchmarks/baselines/2026-11-01-euler308-verification.json',JSON.stringify({checked,oracle:'Direct BigInt FRACTRAN simulation; first 16 emitted powers of two',answers,oracleSteps:step,fixtures:4},null,2)+'\n');
console.log(`${checked} checks passed; direct oracle ${step} FRACTRAN iterations`);
