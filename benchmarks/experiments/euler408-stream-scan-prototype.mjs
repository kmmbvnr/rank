import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/runtime/modular-fold.js'))return result;let source=String(result.source);
source=source.replace('const out = new Int32Array(Number(count));', `if(count>0n) return {shape:[Number(count)], cells:undefined, progression:{start,step,count}};
 const out = new Int32Array(Number(count));`);
source=source.replace('export function modularScan(op, source, axis, seed, modulus) {',`export function modularScan(op, source, axis, seed, modulus) {
 if(source.progression){
  const m=modulusOf(modulus);if(m===undefined||axis!==0)return undefined;
  const {start,step,count}=source.progression, n=Number(count), grow=seed===undefined?0:1;
  const out=new Int32Array(n+grow), combine=stepOf(op,m);
  let r=seedOf(start,m), stride=seedOf(step,m), acc=seed===undefined?r:seedOf(seed,m);
  checkpoint('scanning',n);
  if(grow)out[0]=acc;
  for(let i=0;i<n;i++){
   if(grow||i>0)acc=combine(acc,r);
   out[i+grow]=acc;
   r+=stride;if(r>=m)r-=m;
  }
  return typedArray(out,[out.length]);
 }
`);
source=source.replace('export function modularReduce(op, source, seed, modulus) {',`export function modularReduce(op, source, seed, modulus) {
 if(source.progression){const m=modulusOf(modulus);if(m===undefined)return undefined;
 const {start,step,count}=source.progression,n=Number(count);let r=seedOf(start,m),stride=seedOf(step,m),acc=seed===undefined?r:seedOf(seed,m);const combine=stepOf(op,m);checkpoint('reducing',n);
 for(let i=0;i<n;i++){if(seed!==undefined||i>0)acc=combine(acc,r);r+=stride;if(r>=m)r-=m;}return BigInt(acc);}
`);
return {...result,source};}});
