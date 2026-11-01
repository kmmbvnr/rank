import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sourceFor} from './euler320-variants.mjs';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
function valuation(n,p){let s=0n;for(;n>0n;){n/=p;s+=n;}return s;}
function inverse(p,t){let l=0n,h=p*t;while(l<h){const m=(l+h)/2n;if(valuation(m,p)>=t)h=m;else l=m+1n;}return l;}
const primes=[2,3,5,7,11,13,17,19,23,29,31,97,997,999983];
const targets=[...Array.from({length:150},(_,i)=>BigInt(i)),1000n,1234567890n,1234567890000000n,9007199254740993n];
let helpers=0,programs=0;
for(const mode of ['reference','compiled','exact'])for(const variant of (process.argv.length>2?process.argv.slice(2):['original','cached','greedy','inline'])){
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
 try{
  r.execute(sourceFor(variant).slice(sourceFor(variant).indexOf('fun P Target Prev minimum')));
  for(const p of primes)for(const t of targets){
   const expected=inverse(BigInt(p),t);
   for(const prev of new Set([0n,expected/2n,expected,expected+1n])){
    r.variables.set('Prime',BigInt(p));r.variables.set('Target',t);r.variables.set('Prev',prev);
    const actual=r.execute('Prime Target Prev minimum');assert.equal(actual,expected>prev?expected:prev,`${mode}/${variant}/${p}/${t}/${prev}`);helpers++;
   }
  }
 }finally{r.dispose()}
 for(const upper of [0,1,2,9,10,11,20,100,1000]){
  const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
  let best=0n,expected=0n;const wanted=new Map();
  for(let i=2;i<=upper;i++){
   let n=i;for(let p=2;p<=n;p++)if(n%p===0){let e=0n;while(n%p===0){e++;n/=p;}wanted.set(p,(wanted.get(p)||0n)+1234567890n*e);}
   for(const [p,t]of wanted){const need=inverse(BigInt(p),t);if(need>best)best=need;}
   if(i>=10)expected=(expected+best)%1000000000000000000n;
  }
  try{r.variables.set('Upper',BigInt(upper));r.execute(sourceFor(variant));assert.equal(r.variables.get('Answer'),expected);programs++;}finally{r.dispose()}
 }
}
console.log(JSON.stringify({helpers,programs,failures:0}));
