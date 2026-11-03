import {writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function blood(p,size,cap=Math.floor(2/p)+50){
 const q=1-p,t=new Float64Array(size+1),c=new Float64Array(size+1),pow=new Float64Array(size+1);pow[0]=1;t[1]=1;
 for(let i=1;i<=size;i++)pow[i]=pow[i-1]*q;
 for(let n=2;n<=size;n++){
  let best=size,den=1-pow[n];
  for(let m=1;m<=Math.min(n-1,cap);m++){
   let neg=(pow[m]-pow[n])/den,pos=(1-pow[m])/den;
   let v=1+neg*c[n-m];v+=pos*(c[m]+t[n-m]);best=Math.min(best,v);
  }c[n]=best;best=size;
  for(let m=1;m<=Math.min(n,cap);m++){
   let v=1+t[n-m];v+=(1-pow[m])*c[m];best=Math.min(best,v);
  }t[n]=best;
 }return t[size];
}
if(process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const start=performance.now();let sum=0,maxFullError=0;for(let i=1;i<=50;i++){const capped=blood(i/100,10000),full=blood(i/100,10000,10000);sum+=full;maxFullError=Math.max(maxFullError,Math.abs(capped-full));}
 if(maxFullError!==0)throw Error(`Cap mismatch: ${maxFullError}`);
 console.log(JSON.stringify({sum,maxFullError,oracle:'uncapped full-size DP',ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
 let checks=0,maxDiff=0;
 for(const n of [1,2,3,10,25,51,100,256,512])for(let i=1;i<=50;i++){
  const a=blood(i/100,n),b=blood(i/100,n,n);maxDiff=Math.max(maxDiff,Math.abs(a-b));if(Math.abs(a-b)>1e-10)throw Error(`${n} ${i}: ${a} ${b}`);checks++;
 }console.log(JSON.stringify({checks,maxDiff,oracle:'uncapped recurrence'}));
}
