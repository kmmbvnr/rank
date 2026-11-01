import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {readArrayItem} from '../../packages/interpreter/out/array-storage.js';
const production=readFileSync('demos/euler/308_automaton.ra','utf8');
const results=[];
for(const limit of [1048575,1048576]){
 const expected=new Int32Array(limit+1);
 for(let p=2;p<=limit;p++)if(!expected[p])for(let n=p;n<=limit;n+=p)if(!expected[n])expected[n]=p;
 const prefix=production.slice(0,production.indexOf('Start =')).replace('Ps = primes take Target array\nTop = Ps (Ps len - 1)',`Ps = primes to ${limit} array\nTop = ${limit}`);
 const runtime=new Interpreter(()=>{});
 try{runtime.execute(prefix);const actual=runtime.variables.get('Spf');
  for(let n=0;n<=limit;n++)assert.equal(readArrayItem(actual,n),BigInt(expected[n]),`SPF[${n}] limit ${limit}`);
  results.push({limit,cells:limit+1,passed:true});
 }finally{runtime.dispose();}
}
writeFileSync('benchmarks/baselines/2026-11-01-euler308-boundary.json',JSON.stringify({oracle:'Independent JS Eratosthenes smallest-factor sieve; every cell compared',engine:'compiled',results},null,2)+'\n');
console.log('Both library-boundary tables match all cells');
