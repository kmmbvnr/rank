import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {moonOracle,spherePoints} from './lib/euler353-oracle.mjs';
if(process.env.RANK353_TRUSTED_LOAD==='1')await import('./experiments/euler353-trusted-load-prototype.mjs');
const{Interpreter,isRankArray}=await import(process.env.RANK353_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
let orbits=0,risks=0,maxError=0;
const variants=(process.env.RANK353_VARIANTS || 'quaternion,vector').split(',');
for(const variant of variants)for(const compilation of [false,true]){
 const src=readFileSync(new URL(`./experiments/euler353-${variant}.ra`,import.meta.url),'utf8').split('\nSum =')[0];const r=new Interpreter(()=>{},{compilation});
 try{r.execute(src);
 for(let radius=0;radius<=64;radius++){
  const actual=r.execute(`${radius} moonpoints`);assert.ok(isRankArray(actual));
  const expected=[...new Set(spherePoints(radius,true).map(([x,y,z])=>BigInt((z+radius)*(radius+1)**2+x*(radius+1)+y)))].sort((a,b)=>a<b?-1:a>b?1:0);
  assert.deepEqual(actual.items,expected,`${variant} ${compilation} ${radius}`);orbits++;
 }
 for(const radius of [1,2,3,4,5,6,7,10,15,31,63,127,255]){
  const actual=r.execute(`${radius} moon`),expected=moonOracle(radius);const error=Math.abs(actual-expected);maxError=Math.max(maxError,error);assert.ok(error<1e-14,`${variant} ${compilation} ${radius} ${actual} ${expected}`);risks++;
 }
 }finally{r.dispose()}
}
console.log(JSON.stringify({orbits,risks,maxError,variants,engines:[false,true]}));
