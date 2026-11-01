import {pathToFileURL} from 'node:url';
// The same automaton/transducer algorithm, using native arrays and maps.
export function solve(need, cachePrefixes=false){
 const pattern=String(need),L=pattern.length,pi=Array(L).fill(0),next=Array.from({length:L+1},()=>Array(10).fill(0)),hit=next.map(row=>row.slice());
 for(let i=1;i<L;i++){let j=pi[i-1];while(j>0&&pattern[i]!==pattern[j])j=pi[j-1];if(pattern[i]===pattern[j])j++;pi[i]=j;}
 for(let s=0;s<=L;s++)for(let d=0;d<10;d++){let j=s;while(j>0&&(j===L||pattern[j]!==String(d)))j=pi[j-1];if(j<L&&pattern[j]===String(d))j++;if(j===L){hit[s][d]=1;j=pi[L-1];}next[s][d]=j;}
 const ids=new Map(),ends=new Map(),adds=new Map(),full=new Map(),prefixes=new Map();let merges=0,interns=0,blocks=0;
 function id(e,a){interns++;const key=e.join(',')+':'+a.join(',');if(!ids.has(key)){ids.set(key,key);ends.set(key,e);adds.set(key,a);}return key;}
 const unit=id(Array.from({length:L+1},(_,i)=>i),Array(L+1).fill(0n));
 const dig=Array.from({length:10},(_,d)=>id(next.map(row=>row[d]),hit.map(row=>BigInt(row[d]))));
 function merge(x,y){merges++;const ex=ends.get(x),ey=ends.get(y),ax=adds.get(x),ay=adds.get(y);return id(ex.map(i=>ey[i]),ax.map((n,i)=>n+ay[ex[i]]));}
 function block(x,r){blocks++;const key=x+':'+r;if(full.has(key))return full.get(key);if(!r){full.set(key,x);return x;}let z=unit;for(let d=0;d<10;d++)z=merge(z,block(merge(x,dig[d]),r-1));full.set(key,z);return z;}
 function partial(x,r,top){if(!r)return x;const b=10n**BigInt(r-1),f=Number(top/b);let z=unit;for(let d=0;d<f;d++)z=merge(z,block(merge(x,dig[d]),r-1));return merge(z,partial(merge(x,dig[f]),r-1,top%b));}
 function prefix(w){if(!w)return unit;if(prefixes.has(w))return prefixes.get(w);let z=prefix(w-1);for(let f=1;f<10;f++)z=merge(z,block(dig[f],w-1));prefixes.set(w,z);return z;}
 function ranged(n){if(!n)return unit;const t=String(n),width=t.length;let z=cachePrefixes?prefix(width-1):unit;if(!cachePrefixes)for(let w=1;w<width;w++)for(let f=1;f<10;f++)z=merge(z,block(dig[f],w-1));const f=Number(t[0]),r=width-1;for(let a=1;a<f;a++)z=merge(z,block(dig[a],r));return r?merge(z,partial(dig[f],r,BigInt(t.slice(1)))):merge(z,dig[f]);}
 const count=n=>adds.get(ranged(n))[0];let hi=1n;while(count(hi)<need)hi*=2n;let lo=1n;while(lo<hi){const mid=(lo+hi)/2n;if(count(mid)>=need)hi=mid;else lo=mid+1n;}
 const n=lo,old=count(n-1n);let left=need-old,e=ends.get(ranged(n-1n))[0],pos=before(n-1n),answer=0n;
 for(const [i,c]of Array.from(String(n)).entries()){const d=Number(c);if(hit[e][d]){if(--left===0n){answer=pos+BigInt(i-L+2);break;}}e=next[e][d];}
 return{answer,merges,interns,blocks,states:ids.size};
}
function before(n){if(!n)return 0n;const width=String(n).length;let z=0n;for(let w=1;w<width;w++)z+=9n*10n**BigInt(w-1)*BigInt(w);return z+(n-10n**BigInt(width-1)+1n)*BigInt(width);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const power=Number(process.argv[2]||13),cache=process.argv[3]==='prefix',t=performance.now(),cpu=process.cpuUsage();let answer=0n,merges=0,interns=0,blocks=0,states=0;for(let p=1;p<=power;p++){const row=solve(3n**BigInt(p),cache);answer+=row.answer;merges+=row.merges;interns+=row.interns;blocks+=row.blocks;states+=row.states;}const usage=process.cpuUsage(cpu);if(power===13&&answer!==18174995535140n)throw Error(String(answer));console.log(JSON.stringify({variant:cache?'prefix':'original',power,answer:String(answer),ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,merges,interns,blocks,states}));}
