// Directly factor 510510*i; neither summatory phi nor smooth-number inversion.
export function totientPrefix(limit) {
 const prefix=[0n]; let total=0;
 for(let i=1;i<=limit;i++) {
  let remaining=510510*i, phi=remaining;
  for(let p=2;p*p<=remaining;p++)if(remaining%p===0) {
   phi-=phi/p;
   while(remaining%p===0)remaining/=p;
  }
  if(remaining>1)phi-=phi/remaining;
  total=(total+phi)%1000000000;prefix.push(BigInt(total));
 }
 return prefix;
}
