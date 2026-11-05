// Same capped-remainder DP, fused per-state transitions, sparse Map merging.
import assert from 'node:assert/strict';
const digits=Number(process.argv[2]??19), start=performance.now();
let total=0, peakStates=0, transitions=0;
for(let n=1;n<=digits;n++){
 const powers=Array.from({length:n},(_,i)=>3**i);
 const permutation=powers.map((_,i)=>10*i%n);
 const fast=n%2!==0 && n%5!==0;
 const half=Math.floor(n/2), split=3**half;
 const table=(offset,length)=>{
  const out=new Int32Array(3**length);
  for(let x=0;x<out.length;x++){
   let key=x, sum=0;
   for(let j=0;j<length;j++){sum+=(key%3)*powers[permutation[offset+j]];key=Math.floor(key/3);}
   out[x]=sum;
  }
  return out;
 };
 const low=fast?table(0,half):null, high=fast?table(half,n-half):null;
 let states=new Map([[0,1]]);
 for(let pos=0;pos<n;pos++){
  const next=new Map();
  for(const [key,count] of states){
   const packed=Math.floor(key/2), layer=key%2;
   let scaled=0;
   if(fast)scaled=low[packed%split]+high[Math.floor(packed/split)];
   else{
    const bins=new Int8Array(n); let value=packed;
    for(let i=0;i<n;i++){const r=permutation[i];bins[r]=Math.min(2,bins[r]+value%3);value=Math.floor(value/3);}
    for(let i=0;i<n;i++)scaled+=bins[i]*powers[i];
   }
   for(let digit=pos===0?1:0;digit<10;digit++){
    transitions++;
    const shift=digit%n, up=3**shift, lo=3**(n-shift);
    const rotated=scaled%lo*up+Math.floor(scaled/lo);
    const hits=layer+rotated%3+(shift===0?1:0);
    if(hits>1)continue;
    if(pos===n-1){if(hits===1)total+=count;continue;}
    const add=Math.floor(rotated/up)%3<2?up:0;
    const nk=(rotated+add)*2+hits;
    const nc=(next.get(nk)??0)+count;
    assert(Number.isSafeInteger(nc));next.set(nk,nc);
   }
  }
  states=next;peakStates=Math.max(peakStates,states.size);
 }
}
assert(Number.isSafeInteger(total));
console.log(JSON.stringify({digits,answer:String(total),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,peakStates,transitions}));
