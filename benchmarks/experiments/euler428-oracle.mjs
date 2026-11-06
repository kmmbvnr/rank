// Enumerate divisor pairs in the three circle equations directly. This uses
// neither Mobius counts nor the production quotient/prefix decomposition.
export function necklacePrefix(limit) {
 const prefix=[0n];let total=0n;
 const divisors=n=>{let count=0;for(let d=1;d*d<=n;d++)if(n%d===0)count+=d*d===n?1:2;return count;};
 for(let b=1;b<=limit;b++) {
  const square=b*b;let value=divisors(12*square)+divisors(2*square),product=4*square;
  for(let d=1;d*d<=product;d++)if(product%d===0) {
   const q=product/d;
   if((d+b)%3===0&&(q+b)%3===0)value+=d===q?1:2;
  }
  total+=BigInt(value);prefix.push(total);
 }
 return prefix;
}
