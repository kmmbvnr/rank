// Factor the exact factorial, then enumerate its unitary divisors. No prime
// sieve, Legendre sums or production modular-power/reduction implementation.
export function unitarySquares(n) {
 if(n<0||n>32)throw Error('oracle supports 0..32');
 let factorial=1n;
 for(let k=2;k<=n;k++)factorial*=BigInt(k);
 let rest=factorial;
 const powers=[];
 for(let p=2n;p*p<=rest;p++)if(rest%p===0n) {
  let power=1n;
  while(rest%p===0n){rest/=p;power*=p;}
  powers.push(power);
 }
 if(rest>1n)powers.push(rest);
 let divisors=[1n];
 for(const power of powers)divisors=divisors.concat(divisors.map(d=>d*power));
 return divisors.reduce((sum,d)=>sum+d*d,0n)%1000000009n;
}
