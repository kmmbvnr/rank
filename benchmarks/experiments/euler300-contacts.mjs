// Independent recursive coordinate-walk enumerator; no Rank runtime dependency.
import {pathToFileURL} from 'node:url';
export function contactMaps(n, unrestricted=false) {
 const keys=new Set(),occupied=new Map([['0,0',0]]),x=[0],y=[0],dirs=[[1,0],[0,1],[-1,0],[0,-1]];
 function walk(d,key,turned) {
  if(d===n){keys.add(key);return;}
  for(let k=0;k<4;k++) {
   if(!unrestricted&&(d===1&&k!==0||!turned&&k>1))continue;
   const nx=x[d-1]+dirs[k][0],ny=y[d-1]+dirs[k][1],cell=`${nx},${ny}`;
   if(occupied.has(cell))continue;
   let add=0n;
   for(const [dx,dy] of dirs){const j=occupied.get(`${nx+dx},${ny+dy}`);if(j!==undefined&&j<d-1)add|=1n<<BigInt(j*n+d);}
   x[d]=nx;y[d]=ny;occupied.set(cell,d);walk(d+1,key|add,turned||k!==0);occupied.delete(cell);
  }
 }
 walk(1,0n,false);return [...keys];
}
export function maximalMaps(keys) {
 const pop=x=>x.toString(2).replaceAll('0','').length;
 const ordered=keys.map(key=>({key,size:pop(key)})).sort((a,b)=>b.size-a.size),maximal=[];
 for(const {key,size} of ordered)if(!maximal.some(other=>other.size>size&&(key&other.key)===key))maximal.push({key,size});
 return maximal.map(x=>x.key);
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){const n=Number(process.argv[2]??15),t=performance.now(),keys=contactMaps(n),generation=performance.now()-t,s=performance.now(),maximal=maximalMaps(keys);console.log(JSON.stringify({n,keys:keys.length,maximal:maximal.length,generationMs:generation,pruningMs:performance.now()-s}));}
