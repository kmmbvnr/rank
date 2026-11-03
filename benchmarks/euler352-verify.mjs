import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {blood} from './euler352-oracle.mjs';
const {Interpreter}=await import(process.env.RANK352_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const cases=[];
for(let i=1;i<=50;i++)cases.push([25,i/100]);
for(const n of [1,2,3,10,51,100,256,512])for(const p of [.01,.02,.03,.10,.25,.4,.5])cases.push([n,p]);
let seed=12345;
for(let i=0;i<20;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;cases.push([1+seed%200,(1+seed%50)/100]);}
let checks=0,maxError=0;
for(const file of (process.env.RANK352_VARIANTS||'original,cost,pool-iteration').split(','))for(const compilation of (process.env.RANK352_COMPILED_ONLY?[true]:[false,true])){
 const src=readFileSync(new URL(`./experiments/euler352-${file}.ra`,import.meta.url),'utf8'),r=new Interpreter(()=>{},{compilation});
 try{r.execute(src.slice(0,src.indexOf('\nSum =')));
 for(const[n,p]of cases){const expected=blood(p,n,n),actual=r.execute(`${p} blood ${n}`);assert.equal(typeof actual,'number');maxError=Math.max(maxError,Math.abs(actual-expected));assert.ok(Math.abs(actual-expected)<=1e-9,`${file} ${compilation}: ${p} ${n}: ${actual} vs ${expected}`);checks++;}
 }finally{r.dispose();}
}
console.log(JSON.stringify({checks,inputs:cases.length,maxError,oracle:'uncapped JS recurrence',engines:process.env.RANK352_COMPILED_ONLY?[true]:[false,true]}));
