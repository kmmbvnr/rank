const N=BigInt(process.argv[2]??'100000000000000000');
const start=performance.now(), twice=2n*N;
const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
let top=Math.floor(Math.sqrt(Math.sqrt(Number(64n*N/25n))));
while(BigInt(top+1)**4n<=64n*N/25n)top++;
while(BigInt(top)**4n>64n*N/25n)top--;
let total=0n, candidates=0;
for(let m=3;m<=top;m++)for(let n=Math.floor(m/2)+1;n<m;n++){
 candidates++;
 if((m-2*n)%5===0||gcd(m,n)!==1)continue;
 const g=1+(m%2)*(n%2),a=m*m,b=n*n,c=m*n;
 const u=(b+4*c-a)/g,v=2*(a+c-b)/g;
 if(!Number.isSafeInteger(u)||!Number.isSafeInteger(v))throw Error('unsafe geometry');
 total+=twice/(BigInt(u)*BigInt(v));
}
console.log(JSON.stringify({ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(total),candidates}));
