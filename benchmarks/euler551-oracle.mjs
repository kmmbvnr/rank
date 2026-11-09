const ds=n=>{let sum=0;for(;n;n=Math.floor(n/10))sum+=n%10;return sum;};
export function term(n) {
 const power=100, digits=2, upper=n*36n*BigInt(n.toString().length);
 const levels=(upper/BigInt(power)).toString().length, maxSum=9*levels, size=maxSum+9*digits+1;
 const steps=[new BigInt64Array((maxSum+1)*size)],rests=[new Int32Array((maxSum+1)*size)];
 for(let c=0;c<=maxSum;c++)for(let r=0;r<size;r++){
  let x=r,k=0;if(c===0&&r===0)x=power;
  while(x<power){x+=ds(x)+c;k++;}
  steps[0][c*size+r]=BigInt(k);rests[0][c*size+r]=x-power;
 }
 for(let d=1;d<levels;d++){
  const ks=new BigInt64Array((maxSum+1)*size),rs=new Int32Array(ks.length);
  for(let c=0;c<=maxSum;c++)for(let r=0;r<size;r++){
   let total=0n,x=r;
   for(let j=0;j<10;j++){const key=Math.min(c+j,maxSum)*size+x;total+=steps[d-1][key];x=rests[d-1][key];}
   if(total>9223372036854775807n)throw Error('int64 oracle overflow');
   ks[c*size+r]=total;rs[c*size+r]=x;
  }
  steps.push(ks);rests.push(rs);
 }
 let q=0n,c=0,r=1,left=n-1n;
 for(let d=levels-1;d>=0;d--)for(let i=0;i<9;i++){
  const key=c*size+r,count=steps[d][key];
  if(count<=left){left-=count;r=rests[d][key];q+=10n**BigInt(d);c++;}
 }
 while(left>0n){r+=ds(r)+c;left--;}
 return q*BigInt(power)+BigInt(r);
}
for(const n of [9n,1000000n,1000000000000000n,10000000000000000n])console.log(String(n),String(term(n)));
