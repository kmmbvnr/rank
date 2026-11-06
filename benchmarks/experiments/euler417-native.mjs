import {safeIntegerModularPower as power} from '../../packages/interpreter/out/runtime/modular-power.js';
import {safeIntegerGcd as gcd} from '../../packages/interpreter/out/runtime/integer-gcd.js';
const n=Number(process.argv[2]??100000000),width=Number(process.argv[3]??16),start=performance.now();
if(!Number.isSafeInteger(n)||n<1||n>=2**31)throw Error('control domain: 1 <= N < 2^31');
const size=Math.floor(n/2)+1,sp=width===16?new Uint16Array(size):new Int32Array(size),orders=new Int32Array(size);
for(let p=3;p*p<=n;p+=2)if(sp[p>>>1]===0)for(let i=(p*p)>>>1;i<size;i+=p)if(sp[i]===0)sp[i]=p;
const sieveMs=performance.now()-start;
const smooth=[];for(let a=1;a<=n;a*=2)for(let b=a;b<=n;b*=5)smooth.push(b);smooth.sort((a,b)=>a-b);
let ways=smooth.length,bound=Math.floor(n/smooth[ways-1]),total=0;
for(let m=3;m<=n;m+=2){
 if(m%5===0)continue;
 const p=sp[m>>>1]||m;let r=m,pk=1;
 while(r%p===0){r/=p;pk*=p;}
 let order=0;
 if(m===p){
  let x=p-1;order=x;
  while(x>1){const q=x%2===0?2:sp[x>>>1]||x;while(x%q===0)x/=q;
   while(order%q===0){const e=order/q;if(power(10,e,p)!==1)break;order=e;}
  }
 }else if(r===1){
  order=orders[p>>>1];let pj=p;
  while(pj<pk){pj*=p;if(power(10,order,pj)!==1)order*=p;}
 }else{const a=orders[pk>>>1],b=orders[r>>>1];order=a/gcd(a,b)*b;}
 orders[m>>>1]=order;
 while(m>bound){ways--;bound=Math.floor(n/smooth[ways-1]);}
 total+=order*ways;
}
console.log(JSON.stringify({n,width,sieveMs,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(total)}));
