import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sourceFor} from './euler319-variants.mjs';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
const mod=1000000000n;
// Trial factors and an ungrouped Mobius sum, independent of the linear sieve/cache.
function oracle(n){
 const mu=[0],mertens=[0n],coeff=[0n];let two=1n,three=1n;
 for(let x=1;x<=n;x++){
  let rest=x,sign=1;
  for(let p=2;p*p<=rest;p++)if(rest%p===0){rest/=p;sign=-sign;if(rest%p===0){sign=0;break;}}
  if(rest>1&&sign)sign=-sign;
  mu.push(sign);mertens.push(mertens[x-1]+BigInt(sign));
  two=two*2n%mod;three=three*3n%mod;coeff.push((coeff[x-1]+three-two-1n)%mod);
 }
 let answer=1n;for(let d=1;d<=n;d++)answer+=BigInt(mu[d])*coeff[Math.floor(n/d)];
 return {answer:(answer%mod+mod)%mod,mertens};
}
let cases=0,quotientChecks=0;
for(const n of [1,2,5,10,20,97,100,256,1000]){
 const expected=oracle(n);
 for(const limit of new Set([1,2,3,Math.ceil(Math.sqrt(n)),n,n+1]))
 for(const mode of ['reference','compiled','exact'])
 for(const variant of (process.argv.length>2 ? process.argv.slice(2) : ['original','scan','prefix','whole','primes'])){
  const outputs=[];
  const runtime=new Interpreter(x=>outputs.push(x.trim()),{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
  runtime.variables.set('N',BigInt(n));runtime.variables.set('Limit',BigInt(limit));
  try{
   runtime.execute(sourceFor(variant));
   assert.equal(String((runtime.variables.get('Answer') ?? runtime.lastResult)??outputs.at(-1)),String(expected.answer),`${mode}/${variant}/${n}/${limit}`);
   if(variant!=='whole')for(const q of new Set(Array.from({length:n},(_,i)=>Math.floor(n/(i+1))))){
    assert.equal(runtime.execute(`${q} mertens`),expected.mertens[q]);quotientChecks++;
   }
   cases++;
  }finally{runtime.dispose()}
 }
}
console.log(JSON.stringify({cases,quotientChecks,failures:0}));
