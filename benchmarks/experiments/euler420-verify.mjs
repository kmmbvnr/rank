import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
// Enumerate positive square roots directly, not the p:q/divisor formula.
const bound=200,roots=new Map();
for(let a=1;a*a<bound;a++)for(let d=1;a*a+d*d+2<bound;d++){
 const limit=Math.floor((bound-1-a*a-d*d)/2);
 for(let b=1;b<=limit;b++)for(let c=1;b*c<=limit;c++){
  const matrix=[a*a+b*c,b*(a+d),c*(a+d),d*d+b*c],key=matrix.join(',');
  const entry=roots.get(key);if(entry)entry.count++;else roots.set(key,{trace:matrix[0]+matrix[3],count:1});
 }
}
const oracle=Array(bound+1).fill(0n);
for(const {trace,count}of roots.values())if(count>=2)oracle[trace+1]++;
for(let n=1;n<=bound;n++)oracle[n]+=oracle[n-1];
const variants=['original','parity','indexed','lazy','scoped','copied','filtered','filtered-eager','filtered-scoped','fused-queries','encoded','indexed-search','filtered-eager-search','encoded-search','row-bounds'];
const cases=[3,4,5,10,11,12,19,20,30,50,75,100,150,199,200].map(n=>[n,oracle[n]]);
cases.push([1000,1019n],[100000,518497n]);
let checked=0;
for(const variant of variants){const source=readFileSync(new URL(`./euler420-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [false,true])for(const [n,expected]of cases){
  const runtime=new Interpreter(()=>{},{compilation,args:[`--n=${n}`]});
  try{runtime.execute(source);const answer=(runtime.variables.get('Answer') ?? runtime.lastResult);if(answer!==expected)throw Error(JSON.stringify({variant,compilation,n,expected:String(expected),answer:String(answer)}));checked++;}finally{runtime.dispose();}
 }
}
console.log(JSON.stringify({checked,variants,oracle:'positive matrix root enumeration',smallOracle:cases.slice(0,15).map(([n,v])=>[n,String(v)])}));
