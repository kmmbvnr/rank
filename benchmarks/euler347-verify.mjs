import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK347_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
// Independent oracle: factor every integer, retaining the last member of
// each family with exactly two distinct prime divisors.
const max=20000, expected=new Array(max+1).fill(0n), best=new Map();
let sum=0n;
for(let n=2;n<=max;n++) {
 let v=n;const factors=[];
 for(let p=2;p*p<=v;p++) if(v%p===0) {factors.push(p);while(v%p===0)v/=p;}
 if(v>1)factors.push(v);
 if(factors.length===2) {const key=factors.join(',');sum+=BigInt(n)-(best.get(key)||0n);best.set(key,BigInt(n));}
 expected[n]=sum;
}
const limits=[...Array.from({length:257},(_,i)=>i),5,6,7,11,12,13,17,18,19,35,36,37,99,100,101,999,1000,1001,19999,20000];
let seed=347;
for(let i=0;i<64;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;limits.push(seed%(max+1));}
let count=0;
for(const name of ['original','half','stair','prefix','batch','batch2','slice','fast','delivered']) for(const compilation of [true,false]) {
 const file=new URL(name==='delivered'?'../demos/euler/347_twoprimes.ra':`experiments/euler347-${name}.ra`,import.meta.url);
 const source=readFileSync(file,'utf8').split('\nAnswer =')[0];
 const output=[];const r=new Interpreter(t=>output.push(t.trim()),{compilation});
 try {r.execute(source);for(const n of limits) {r.execute(`${n} twoprimes print`);assert.equal(output.at(-1),String(expected[n]),`${name} ${compilation} ${n}`);count++;}}
 finally {r.dispose();}
}
console.log(JSON.stringify({comparisons:count,limits:limits.length,oracle:'integer factorization',max}));
