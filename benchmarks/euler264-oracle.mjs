// Independent bounded lattice-circle enumeration; no modular direction search.
export function oracle(limit){
 const maxR2=Math.floor((limit*limit+25)/9),side=Math.floor(Math.sqrt(maxR2));
 const circles=new Map();
 for(let x=-side;x<=side;x++)for(let y=-side;y<=side;y++){
  const q=x*x+y*y;if(!q||q>maxR2)continue;
  let points=circles.get(q);if(!points)circles.set(q,points=[]);points.push([x,y]);
 }
 let sum=0,count=0;const keys=[];
 for(const [q,points]of circles){
  const positions=new Map(points.map((p,i)=>[p.join(','),i]));
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   const a=points[i],b=points[j],c=[5-a[0]-b[0],-a[1]-b[1]];
   const k=positions.get(c.join(','));if(k===undefined||k<=j)continue;
   if((b[0]-a[0])*(c[1]-a[1])===(b[1]-a[1])*(c[0]-a[0]))continue;
   const p=Math.hypot(a[0]-b[0],a[1]-b[1])+Math.hypot(a[0]-c[0],a[1]-c[1])+Math.hypot(b[0]-c[0],b[1]-c[1]);
   if(p<=limit){sum+=p;count++;keys.push([a,b,c].map(p=>p.join(',')).sort().join(';'));}
  }
 }
 return {answer:+sum.toFixed(4),count,keys:keys.sort()};
}
