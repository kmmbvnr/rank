import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {solve} from './euler305-native.mjs';
const cases=[1,3,5,9,10,11,12,19,33,99,101,120],text=Array.from({length:200000},(_,i)=>String(i+1)).join('');
function brute(need){let at=-1;for(let n=0;n<need;n++){at=text.indexOf(String(need),at+1);assert.notEqual(at,-1,'oracle budget');}return BigInt(at+1);}
const expected=cases.map(n=>brute(n));let checks=0;
for(let i=0;i<cases.length;i++)for(const cache of [false,true]){assert.equal(solve(BigInt(cases[i]),cache).answer,expected[i]);checks++;}
for(const variant of ['original','numeric','combined','compact','production'])for(const compilation of [false,true]){
 const r=new Interpreter(()=>{},{compilation});try{
  const source=readFileSync(new URL(variant==='production'?'../../demos/euler/305_reflexive.ra':`./euler305-${variant}.ra`,import.meta.url),'utf8').replace('arg Power integer = 13','arg Power integer = 0');r.execute(source);
  for(let i=0;i<cases.length;i++){assert.equal(r.execute(`${cases[i]} solve`),expected[i],`${variant}/${compilation}/${cases[i]}`);checks++;}
  assert.equal(r.execute('7780 solve'),111111365n);checks++;
 }finally{r.dispose();}
}
writeFileSync('benchmarks/baselines/2026-11-01-euler305-verification.json',JSON.stringify({checks,cases,expected:expected.map(String),published7780:'111111365'},null,2)+'\n');console.log(`${checks} checks passed`);
