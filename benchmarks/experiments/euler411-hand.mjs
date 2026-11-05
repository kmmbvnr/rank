const powmod=(a,e,n)=>{let v=1;while(e){if(e%2)v=v*a%n;a=a*a%n;e=Math.floor(e/2);}return v;};
const factors=n=>{const fs=[];for(let p=2;p*p<=n;p++){if(n%p)continue;fs.push(p);while(n%p===0)n/=p;}if(n>1)fs.push(n);return fs;};
const order=(a,n)=>{if(n===1)return 1;let d=n;for(const p of factors(n))d=d/p*(p-1);for(const p of factors(d))while(d%p===0&&powmod(a,d/p,n)===1)d/=p;return d;};
const gcd=(a,b)=>b?gcd(b,a%b):a;
const start=performance.now();let answer=0;const rows=[];
for(let k=1;k<=30;k++){
 const t=performance.now(),n=k**5;let n2=n,n3=n,al=0,be=0;
 while(n2%2===0){n2/=2;al++;}while(n3%3===0){n3/=3;be++;}
 const o2=order(2,n2),o3=order(3,n3),period=o2/gcd(o2,o3)*o3,len=Math.min(2*n+1,Math.max(al,be)+period);
 const keys=new Float64Array(len);let x=1,y=1;
 for(let i=0;i<len;i++){keys[i]=x*n+y;x=x*2%n;y=y*3%n;}
 const generated=performance.now();keys.sort();const sorted=performance.now();
 let tails=new Float64Array(process.argv[2]==='grow'?1024:len),ln=0,prev=-1;
 for(let i=0;i<len;i++){
  const cu=keys[i];if(cu===prev)continue;prev=cu;const v=cu%n;
  let lo=0,hi=ln;
  if(process.argv[2]!=='plain'&&ln&&tails[ln-1]<=v)lo=ln;
  else while(lo<hi){const mid=Math.floor((lo+hi)/2);if(tails[mid]>v)hi=mid;else lo=mid+1;}
  if(lo>=tails.length){const bigger=new Float64Array(tails.length*2);bigger.set(tails);tails=bigger;}
  tails[lo]=v;if(lo===ln)ln++;
 }
 answer+=ln;rows.push({k,len,ln,generateMs:generated-t,sortMs:sorted-generated,scanMs:performance.now()-sorted});
}
console.log(JSON.stringify({variant:process.argv[2]??'append',answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,rows}));
