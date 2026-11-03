import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Interpreter}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const modulus=100000007n;
function seating(n){
 const full=(1<<n)-1, memo=new Map();
 function count(mask){
  if(mask===full)return 1n;
  if(memo.has(mask))return memo.get(mask);
  let best=3, candidates=[];
  for(let j=0;j<n;j++)if(!(mask>>j&1)){
   const score=(j>0?(mask>>(j-1)&1):0)+(j+1<n?(mask>>(j+1)&1):0);
   if(score<best){best=score;candidates=[]}
   if(score===best)candidates.push(j);
  }
  const total=candidates.reduce((s,j)=>s+count(mask|1<<j),0n);memo.set(mask,total);return total;
 }
 return count(0)%modulus;
}
function exactFormula(n){
 const f=[1n];for(let i=1;i<=n;i++)f.push(f[i-1]*BigInt(i));
 let sum=0n;
 for(let a=1;a<=2;a++)for(let b=0;b<=1;b++){
  const l=n-a-b,e=b+(a===2?1:0);
  for(let p=((l%2)+2)%2;p<=Math.floor(l/3);p+=2){
   const k=1+(l-p)/2;
   sum+=f[k-1]/(f[p]*f[k-1-p])*(2n**BigInt(p))*f[k]*f[p+e]*f[k-1];
  }
 }
 return sum%modulus;
}
const cases=Array.from({length:12},(_,i)=>[i+1,seating(i+1)]);
for(const n of [20,30,100,200,1000])cases.push([n,exactFormula(n)]);
assert.equal(cases[9][1],61632n);assert.equal(cases.at(-1)[1],47255094n);
let checks=0;
for(const variant of ['production','original','scans-grouped','array','plans'])for(const compilation of [true,false])for(const [n,want]of cases){
 const r=new Interpreter(()=>{},{compilation,args:['--n',String(n)]});
 try{const result=r.execute(readFileSync(new URL(variant==='production'?'../demos/euler/364_distance.ra':`./experiments/euler364-${variant}.ra`,import.meta.url),'utf8'));assert.equal(result,want,`${variant} ${n} ${compilation}`);checks++}finally{r.dispose()}
}
console.log(JSON.stringify({checks,seatingThrough:12,formulaCases:cases.slice(12).map(c=>c[0])}));
