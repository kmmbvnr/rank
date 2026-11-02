import assert from 'node:assert/strict';
const m=Number(process.argv[2]??1000000),n=BigInt(process.argv[3]??1000000000000);
const seen=new Uint32Array(m),tail=new Uint32Array(m),period=6*m;
const whole=n/BigInt(period),rest=Number(n%BigInt(period));
const b=[-1,3,6,7,13,14],c=[0,1,2,2,5,5],alpha=[4,3,1,6,1,3],beta=[1,1,0,3,0,3];
let weight=0n,prefix=0,answer=0n;
const start=performance.now();
for(let i=0;i<period;i++){
 const t=Math.floor(i/6),r=i%6;
 const predicted=((9*t*t+b[r]*t+c[r])%m+m)%m;
 assert.equal(prefix,predicted);
 seen[prefix]++;if(i<=rest)tail[prefix]++;
 const k=BigInt(i+1),a=i===0?1n:weight%k;
 assert.equal(a,BigInt(alpha[r]*t+beta[r]));
 weight+=k*a;prefix=(prefix+Number(a))%m;
}
for(let i=0;i<m;i++){const count=whole*BigInt(seen[i])+BigInt(tail[i]);answer+=count*(count-1n)/2n;}
console.log(JSON.stringify({m,n:String(n),answer:String(answer),sequenceChecks:period,prefixChecks:period,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
