import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
const limits=[...Array.from({length:101},(_,i)=>i),121,143,144,145,168,169,170,255,256,257,400];
const counts=Array(401).fill(0n);
const gcd=(a,b)=>b?gcd(b,a%b):a;
for(let a=1;a<=133;a++)for(let b=a;a+2*b<=400;b++)for(let c=b;c<a+b&&a+b+c<=400;c++)if(gcd(gcd(a,b),c)===1)counts[a+b+c]++;
for(let n=1;n<counts.length;n++)counts[n]+=counts[n-1];
let checks=0;
for(const compilation of[true,false])for(const variant of['original','formula','grouped','shipping']){
 let source=readFileSync(new URL(variant==='shipping'?'../demos/euler/276_primitivetriangles.ra':`./experiments/euler276-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 10000000','');
 const r=new Interpreter(()=>{},{compilation});
 try{for(const limit of limits){r.execute(`Limit = ${limit}\n`+source);assert.equal(r.variables.get('Answer'),counts[limit],`${compilation}/${variant}/${limit}`);checks++;}}finally{r.dispose()}
}
const A=[0,2,3,6,8,12,15,20,24,30,35,42].map(BigInt),B=[0,0,0,1,1,2,3,5,6,9,11,15].map(BigInt);
let sum=0n;
for(let n=0n;n<=20000n;n++){
 const base=n+3n*(n%2n);sum+=(base*base+24n)/48n;
 const k=n/12n,r=n%12n;
 assert.equal(((12n*k+3n*r+6n)*k+A[Number(r)])*k+B[Number(r)],sum);checks++;
}
console.log(JSON.stringify({checks,engines:2,variants:4,limits,oracle:'direct integer sides, triangle inequality, gcd; direct perimeter-prefix check through 20000'}));
