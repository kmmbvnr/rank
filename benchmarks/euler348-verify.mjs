import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const {Interpreter}=await import(process.env.RANK348_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const source=readFileSync(new URL('../demos/euler/348_squarecube.ra',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('\nAnswer ='));
// Independent exhaustive (square, cube) enumeration, retaining palindromes only.
const last=796767697, counts=new Map();
let pairs=0;
for(let b=2;b*b*b+4<=last;b++){
 const cube=b*b*b;
 for(let a=2;a*a+cube<=last;a++){
  const n=a*a+cube,s=String(n);let palindrome=true;
  for(let i=0;i<s.length/2;i++)if(s[i]!==s[s.length-1-i]){palindrome=false;break;}
  if(palindrome)counts.set(n,(counts.get(n)||0)+1);
  pairs++;
 }
}
const hits=[...counts].filter(([,count])=>count===4).map(([n])=>n).sort((a,b)=>a-b);
assert.deepEqual(hits,[5229225,37088073,56200265,108909801,796767697]);
assert.equal(hits.reduce((a,b)=>a+b,0),1004195061);
// For small arbitrary inputs, enumerate squares first, independently of reps.
const small=Array(10001).fill(0);
for(let a=2;a*a+8<small.length;a++)for(let b=2;a*a+b*b*b<small.length;b++)small[a*a+b*b*b]++;
let checks=0;
for(const compilation of [false,true]){
 const r=new Interpreter(()=>{},{compilation});
 try{
  r.execute(helpers);
  for(let n=0;n<small.length;n+=n<100?1:37){assert.equal(r.execute(`${n} reps`),BigInt(small[n]));checks++;}
  for(const n of hits){assert.equal(r.execute(`${n} reps`),4n);checks++;}
  for(let n=0;n<=200;n++)for(const odd of [false,true]){
   const s=String(n), tail=odd?s.slice(0,-1):s;
   assert.equal(r.execute(`${n} mirror ${odd}`),BigInt(s+[...tail].reverse().join('')));checks++;
  }
 }finally{r.dispose();}
}
console.log(JSON.stringify({pairs,hits,answer:1004195061,checks,engines:[false,true]}));
