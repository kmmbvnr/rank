import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sourceFor} from './euler324-variants.mjs';
import {recurrence,period,certify,product,modulus} from './euler324-oracle.mjs';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter,formatValue}=await import(`${root}/packages/interpreter/out/index.js`);
certify();
const inputs=[...Array.from({length:25},(_,i)=>BigInt(i)),50n,500n,500000n,2n**53n+1n,period-1n,period,period+1n,2n*period+29n];
const expected=new Map(inputs.map(n=>[n,recurrence(n)]));
let programs=0,combinations=0;
for(const mode of ['reference','compiled','exact'])for(const variant of (process.argv.length>2?process.argv.slice(2):['original','period','convolve','period-convolve','period-parity'])){
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
 try{
  r.variables.set('Exp',0n);r.execute(sourceFor(variant));
  for(const n of inputs){r.variables.set('NValue',n);assert.equal(r.execute('NValue recurrence'),expected.get(n),`${mode}/${variant}/${n}`);programs++;}
  for(let trial=0;trial<4;trial++){
   const a=Array.from({length:23},(_,i)=>BigInt((i*7919+trial*104729)%100000007));
   const b=Array.from({length:23},(_,i)=>trial===0?a[i]:BigInt((i*31+trial*982451)%100000007));
   r.execute(`Left = array ${a.join(' ')}\nRight = array ${b.join(' ')}`);
   const value=r.execute('(Left combine Right) mod Mod');
   assert.equal(formatValue(value),product(a,b).join(' '));combinations++;
  }
 }finally{r.dispose()}
}
console.log(JSON.stringify({programs,combinations,periodCertificate:true,failures:0}));
