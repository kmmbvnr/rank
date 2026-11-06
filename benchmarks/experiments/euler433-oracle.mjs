// Direct Euclid over the square. No inversion or floor-sum recurrence.
export function euclidTotal(n) {
 let total=0;
 for(let a=1;a<=n;a++)for(let b=1;b<=n;b++){
  let x=a,y=b;
  while(y){[x,y]=[y,x%y];total++;}
 }
 return BigInt(total);
}

// Direct summation of the two lattice strips, independent of the signed walk.
export function chainTotal(q) {
 const root=Math.floor(Math.sqrt(q));let total=0;
 for(let x=2;x<=root;x++)for(let y=1;y<x;y++){
  const split=Math.floor(q/(x+y)),triangle=split*(split-1)/2;
  const sum=k=>{let result=0;for(let i=1;i<=k;i++)result+=Math.floor((q-split*x-x*i)/y);return result;};
  const first=triangle+sum(Math.floor(q/x)-split);
  const second=split<=root?triangle+sum(root-split):root*(root-1)/2;
  total+=2*first-second;
 }
 return BigInt(total);
}
