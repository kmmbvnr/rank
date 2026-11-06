import {safeIntegerGcd as gcd} from '../../packages/interpreter/out/runtime/integer-gcd.js';
const n=Number(process.argv[2]??10000000),start=performance.now();
if(!Number.isInteger(n)||n<3||n>10000000)throw Error('control domain: 3 <= N <= 10^7');
const bound=Math.floor((2*n-1)/4),top=Math.floor(Math.sqrt(bound)),width=top+1,stride=width*width;
let lists=[[],[]];let candidates=0;
for(let p=2;p<=top;p++)for(let q=1,last=Math.min(p-1,Math.floor(Math.sqrt(bound-p*p)));q<=last;q++){
 candidates++;if(gcd(p,q)!==1)continue;
 const sum=p*p+q*q,key=sum*stride+p*width+q;
 lists[(p-q)%2===1?0:1].push(key);
}
const keys=lists.map(a=>Float64Array.from(a).sort());lists=undefined;
const pairsMs=performance.now()-start;
const limit=Math.floor(Math.sqrt(Math.floor((2*n-1)/5))),max=Math.floor(limit*limit/4);
const tau=new Int32Array(max+1);
for(let d=1;d*d<=max;d++){for(let x=d*d;x<=max;x+=d)tau[x]+=2;tau[d*d]--;}
const setupMs=performance.now()-start;
const counts=keys.map(a=>a.length),prefix=new Int32Array(Math.floor(limit/2)+2);
let answer=0;
for(let size=2;size<=limit;size++){
 const cap=Math.floor((2*n-1)/(size*size)),parity=size%2;
 for(let group=0;group<2;group++)while(counts[group]>0&&Math.floor(keys[group][counts[group]-1]/stride)>cap)counts[group]--;
 prefix[0]=0;let count=0;
 for(let m=parity;m<size;m+=2){count++;prefix[count]=prefix[count-1]+tau[(size*size-m*m)/4]*(m===0?1:2);}
 for(let group=parity;group<2;group++)for(let i=0;i<counts[group];i++){
  const rem=keys[group][i]%stride,p=Math.floor(rem/width),q=rem%width;
  const last=Math.floor((size*q-1)/p),index=Math.floor((last+2-parity)/2);
  answer+=prefix[index];
 }
}
console.log(JSON.stringify({n,answer:String(answer),candidates,pairs:keys.map(a=>a.length),pairsMs,setupMs,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
