import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const bs=7**5,pw=Array.from({length:5},(_,i)=>7**i),codes=[0],ids=new Map([[0,0]]),edges=[];
for(let i=0;i<codes.length;i++){
 const code=codes[i],l=Math.floor(code/bs),rs=pw.map(p=>Math.floor(code%bs/p)%7);
 const left=Array.from({length:l},(_,p)=>p),right=rs.filter(x=>x!==0).map((x,j)=>x===1?-j-1:x-2);
 const symbols=[...new Set([...left,...right])];
 const moves=[...symbols.map(x=>[x,1]),[100,10-symbols.length]];
 edges[i]=[];
 for(const [x,w] of moves){if(w===0)continue;
  const a=left.slice(),b=right.slice(),hitA=a.includes(x),hitB=b.includes(x);
  if(hitA)a.splice(a.indexOf(x),1);else if(a.length===5)a.shift();a.push(x);
  if(!hitB){if(b.length===5)b.shift();b.push(x);}
  const digits=b.map(v=>{const j=a.indexOf(v);return j<0?1:j+2;});
  const next=a.length*bs+digits.reduce((z,d,j)=>z+d*pw[j+5-digits.length],0);
  if(!ids.has(next)){ids.set(next,codes.length);codes.push(next);}
  edges[i].push({to:ids.get(next),delta:Number(hitA)-Number(hitB),weight:w});
 }
 assert.equal(edges[i].reduce((n,e)=>n+e.weight,0),10);
}
const turns=50,width=2*turns+1,off=turns,size=codes.length*width;
let dp=Array(size).fill(0n);dp[off]=1n;
let den=1n;const values=[];
for(let t=0;t<=turns;t++){
 let num=0n,mass=0n;for(let i=0;i<size;i++){mass+=dp[i];num+=dp[i]*BigInt(Math.abs(i%width-off));}
 assert.equal(mass,den);const rounded=(num*100000000n+den/2n)/den;
 values.push({turns:t,answer:Number(rounded)/1e8,numerator:String(num),denominator:String(den)});
 if(t===turns)break;
 const next=Array(size).fill(0n);
 for(let s=0;s<codes.length;s++)for(const e of edges[s])for(let d=-t;d<=t;d++){
  const n=dp[s*width+off+d];if(n)next[e.to*width+off+d+e.delta]+=n*BigInt(e.weight);
 }
 dp=next;den*=10n;
}
assert.equal(values[50].answer,1.76882294);assert.equal(values[20].answer,.79884191);
const result={states:codes.length,edges:edges.flat().length,codes,transitions:edges,method:'Direct LRU/FIFO queues, canonical renaming, exact BigInt path counts without per-edge rounding',values};
writeFileSync('benchmarks/baselines/2026-10-31-euler298-oracle.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({states:result.states,edges:result.edges,values:values.filter(v=>[0,5,6,7,10,20,50].includes(v.turns))}));
