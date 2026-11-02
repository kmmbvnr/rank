// Independent totient sieve for small inputs, and subset recursion for full L.
export function sieveSum(limit) {
 const phi=Uint32Array.from({length:limit+1},(_,i)=>i);
 for(let p=2;p<=limit;p++)if(phi[p]===p)for(let n=p;n<=limit;n+=p)phi[n]-=phi[n]/p;
 let sum=0n;
 for(let n=1;n<=limit;n++){
  let value=phi[n];for(const p of [2,3,5])while(value>1&&value%p===0)value/=p;
  if(value===1)sum+=BigInt(n);
 }
 return sum%4294967296n;
}
export function subsetSum(limit) {
 const smooth=[];
 for(let a=1;a<=limit;a*=2)for(let b=a;b<=limit;b*=3)for(let c=b;c<=limit;c*=5)smooth.push(c);
 smooth.sort((a,b)=>a-b);
 const root=Math.floor(Math.sqrt(limit+1)),sieve=new Uint8Array(root+1),primes=[];
 for(let n=2;n<=root;n++)if(!sieve[n]){
  primes.push(n);for(let m=n*n;m<=root;m+=n)sieve[m]=1;
 }
 const prime=n=>{for(const p of primes){if(p*p>n)break;if(n%p===0)return false;}return true;};
 const candidates=smooth.map(h=>h+1).filter(n=>n>5&&prime(n));
 const prefix=[0n];for(const h of smooth)prefix.push(prefix.at(-1)+BigInt(h));
 let sum=0n,products=0;
 const visit=(q,start)=>{
  const bound=Math.floor(limit/q);let lo=0,hi=smooth.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(smooth[mid]<=bound)lo=mid+1;else hi=mid;}
  sum+=BigInt(q)*prefix[lo];products++;
  for(let i=start;i<candidates.length&&candidates[i]<=bound;i++)visit(q*candidates[i],i+1);
 };
 if(limit>=1)visit(1,0);
 return {answer:sum%4294967296n,smooth:smooth.length,primes:candidates.length,products};
}
