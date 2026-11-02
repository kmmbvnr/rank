// Independent geometry: no primitive directions or line-length formula.
export function hullArea(points) {
 if(points.length<3)return 0;
 const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=items=>{const h=[];for(const p of items){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
 const hull=half(sorted).slice(0,-1).concat(half(sorted.slice().reverse()).slice(0,-1));
 let twice=0;for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length];twice+=a[0]*b[1]-a[1]*b[0];}
 return Math.abs(twice)/2;
}
const points=n=>Array.from({length:(n+1)**2},(_,i)=>[Math.floor(i/(n+1)),i%(n+1)]);
export function exhaustiveExpectation(n) {
 const cells=points(n),p=1/(n+1),q=1-p;let result=0;
 if(cells.length>16)throw Error('subset oracle limited to N <= 3');
 for(let bits=0;bits<2**cells.length;bits++){
  const chosen=cells.filter((_,i)=>bits&(1<<i));
  result+=hullArea(chosen)*p**chosen.length*q**(cells.length-chosen.length);
 }
 return result;
}
export function edgeExpectation(n) {
 const cells=points(n),p=1/(n+1),q=1-p;let result=0;
 for(const a of cells)for(const b of cells){
  if(a===b)continue;
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  let absent=0,left=0;
  for(const c of cells){
   const x=c[0]-a[0],y=c[1]-a[1],side=dx*y-dy*x,dot=dx*x+dy*y;
   if(side<0||side===0&&(dot<0||dot>len))absent++;
   if(side>0)left++;
  }
  result+=(a[0]*b[1]-a[1]*b[0])*p*p*q**absent*(1-q**left)/2;
 }
 return result;
}
