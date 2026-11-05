const first=+(process.argv[2]??2),last=+(process.argv[3]??300);
const start=performance.now();let total=0n,states=0,walks=0,maxDepth=0;
const maxBase=6*last+3,storage=process.env.RANK414_REUSE?new Uint16Array(maxBase*maxBase):undefined;
for(let k=first;k<=last;k++){
 const b=6*k+3,dd=storage?storage.subarray(0,b*b):new Uint16Array(b*b),stack=[];dd.fill(0);dd[(2*b/3)*b+b/3]=1;let sum=0n;
 for(let u=1;u<b;u++)for(let v=0;v<=u;v++){
  states++;const i=u*b+v;
  if(!dd[i]){
   let x=u,y=v,ci=i;stack.length=0;
   while(!dd[ci]){
    stack.push(ci);walks++;
    const digits=y?[b-x,b-1-y,b-1,y-1,x]:[b-x,b-1,b-1,b-1,x-1];
    let [a,c,d,e,f]=digits,t;
    t=Math.min(a,c);c=Math.max(a,c);a=t;
    t=Math.min(e,f);f=Math.max(e,f);e=t;
    t=Math.min(d,f);f=Math.max(d,f);d=t;
    t=Math.min(d,e);e=Math.max(d,e);d=t;
    t=Math.min(c,f);f=Math.max(c,f);c=t;
    t=Math.min(a,e);e=Math.max(a,e);a=t;
    t=Math.min(a,d);d=Math.max(a,d);a=t;
    t=Math.min(c,e);e=Math.max(c,e);c=t;
    t=Math.min(c,d);d=Math.max(c,d);c=t;
    x=f-a;y=e-c;ci=x*b+y;
   }
   let d=dd[ci];maxDepth=Math.max(maxDepth,stack.length);
   while(stack.length)dd[stack.pop()]=++d;
  }
  let mu=100+120*(v-1)+120*v*(u-v-1);
  if(u===v)mu=20+30*(u-1);if(!v)mu=10+20*(u-1);
  const wt=mu*(b-u)*dd[i];if(!Number.isSafeInteger(wt))throw Error('unsafe');sum+=BigInt(wt);
 }
 total+=sum-1n;
}
console.log(JSON.stringify({first,last,reuse:!!storage,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(total%1000000000000000000n),states,walks,maxDepth}));
