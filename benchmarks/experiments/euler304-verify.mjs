import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const variants=['original','eager','scalar','gaps','prefix','prefixeager','production'];
const cases=[[0,1,97],[1,8,2],[2,10,1],[10,4,1000000007],[31,12,1234567891011],[60,4,97],[127,10,997],[250,20,1000000007]];
const prime=n=>{if(n<2)return false;for(let d=2;d*d<=n;d++)if(n%d===0)return false;return true;};
function expected(start,count,mod){let answer=0n,n=start,found=0;while(found<count){if(prime(n)){let a=0n,b=1n;for(let j=0;j<n;j++)[a,b]=[b,(a+b)%BigInt(mod)];answer=(answer+a)%BigInt(mod);found++;}n++;}return String(answer);}
let checked=0;
for(const [start,count,mod] of cases)for(const variant of variants)for(const compilation of [false,true]){
 let source=readFileSync(variant==='production'?'demos/euler/304_primonacci.ra':'benchmarks/experiments/euler304-original.ra','utf8').replace('arg Start integer = 10 ** 14',`arg Start integer = ${start}`).replace('arg Count integer = 100000',`arg Count integer = ${count}`).replace('arg Mod integer = 1234567891011',`arg Mod integer = ${mod}`);
 if(['scalar','gaps','prefix','prefixeager'].includes(variant))source=source.slice(0,source.indexOf('F0 ='))+readFileSync(`benchmarks/experiments/euler304-${variant==='prefixeager'?'prefix':variant}.ra`,'utf8');
 if(['eager','prefixeager'].includes(variant))source=source.replaceAll("Twice' =",'Twice =').replaceAll("Shifted' =",'Shifted =').replaceAll("Next' =",'Next =');
 const r=new Interpreter(()=>{},{compilation});try{r.execute(source);assert.equal(String((r.variables.get('Answer') ?? r.lastResult)),expected(start,count,mod),JSON.stringify({start,count,mod,variant,compilation}));checked++;}finally{r.dispose();}
}
writeFileSync('benchmarks/baselines/2026-11-01-euler304-verification.json',JSON.stringify({checked,cases,variants,oracle:'Trial division for primes; linear Fibonacci recurrence for each index'},null,2)+'\n');console.log(`${checked} independent small checks passed`);
