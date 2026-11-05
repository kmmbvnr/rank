const R=+(process.argv[2]??100000000),X=+(process.argv[3]??1000000000),Block=+(process.argv[4]??10000000),L=Math.min(R,X),t=performance.now();
const root=Math.floor(Math.sqrt(L)),composite=new Uint8Array(root+1),primes=[];
for(let p=2;p<=root;p++)if(!composite[p]){primes.push(p);for(let j=p*p;j<=root;j+=p)composite[j]=1}
let total=0n;
for(let lo=1;lo<=L;lo+=Block){
 const hi=Math.min(L,lo+Block-1),len=hi-lo+1,smooth=new Uint32Array(len).fill(1),omega=new Uint8Array(len);
 for(const p of primes)for(let q=p;q<=hi;q*=p){let s=Math.ceil(lo/q)*q-lo;for(let j=s;j<len;j+=q){smooth[j]*=p;if(q===p)omega[j]++}}
 let subtotal=0;
 for(let j=0;j<len;j++){
  const m=lo+j,w=2**(omega[j]+(smooth[j]<m)),a=Math.floor(R/m),b=Math.floor(X/m);
  if(a*b*w*2>Number.MAX_SAFE_INTEGER){const aa=BigInt(a),bb=BigInt(b);total+=BigInt(w)*(m%2?2n*aa*bb:aa*bb+(aa%2n)*(bb%2n));continue;}
  const term=w*(m%2?2*a*b:a*b+(a%2)*(b%2));
  if(subtotal>Number.MAX_SAFE_INTEGER-term){total+=BigInt(subtotal);subtotal=0}subtotal+=term;
 }total+=BigInt(subtotal);
}
console.log(JSON.stringify({ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(2n*total)}));
