import assert from 'node:assert/strict';
const upper=Number(process.argv[2]??1000000),k=1234567890;
const spf=new Int32Array(upper+1),want=new Float64Array(upper+1);
for(let p=2;p<=upper;p++)if(!spf[p])for(let n=p;n<=upper;n+=p)if(!spf[n])spf[n]=p;
function val(n,p){let s=0;while(n){n=Math.floor(n/p);s+=n;}return s;}
function inverse(p,t){let l=0,h=p*t;assert(Number.isSafeInteger(h)&&h<2**52);while(l<h){const m=l+Math.floor((h-l)/2);if(val(m,p)>=t)h=m;else l=m+1;}return l;}
const t=performance.now();let best=0,answer=0n,searches=0,checks=0;
for(let i=2;i<=upper;i++){
 let x=i;
 while(x>1){const p=spf[x];let e=0;while(x%p===0){x/=p;e++;}want[p]+=k*e;checks++;
  assert(Number.isSafeInteger(want[p]));
  if(val(best,p)<want[p]){best=inverse(p,want[p]);searches++;}
 }
 if(i>=10)answer=(answer+BigInt(best))%1000000000000000000n;
}
if(upper===1000)assert.equal(answer,614538266565663n);
console.log(JSON.stringify({upper,answer:String(answer),best,searches,checks,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024}));
