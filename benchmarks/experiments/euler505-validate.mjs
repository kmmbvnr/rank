import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const q=1n<<60n,m=q-1n;
function oracle(n){
 const x=Array(2*n).fill(0n);x[1]=1n;
 for(let k=2;k<2*n;k++)x[k]=((k%2?2n:3n)*x[k>>1]+(k%2?3n:2n)*x[k>>2])%q;
 for(let k=n-1;k>=1;k--)x[k]=m-(x[2*k]>x[2*k+1]?x[2*k]:x[2*k+1]);
 return x[1];
}
const base=readFileSync(new URL('./euler505-baseline.ra',import.meta.url),'utf8');
const sources={production:readFileSync(new URL('../../demos/euler/505_bidirectional.ra',import.meta.url),'utf8'),original:base,branches:readFileSync(new URL('./euler505-branches.ra',import.meta.url),'utf8'),recursive:readFileSync(new URL('./euler505-recursive.ra',import.meta.url),'utf8')};
const ns=[...Array.from({length:150},(_,i)=>i+1),...Array.from({length:16},(_,i)=>2**(i+1)).flatMap(n=>[n-1,n,n+1]),1000,10000,1000000];
const expectedValues=new Map(ns.map(n=>[n,oracle(n)]));
let checks=0;
for(const [name,source] of Object.entries(sources))for(const compilation of [false,true]){
 const r=new Interpreter(()=>{},{compilation});
 try{
  // Parse helpers once; varying N uses the same declarations and runtime.
  const mainStart=source.indexOf(source.includes('fun K X P A B search')?'Answer = 1 1 0':'Answer = 1\n');
  r.execute(source.slice(0,mainStart).replace('arg N integer = 1000000000000','N = 1'));
  const main=source.slice(mainStart);
  for(const n of ns){r.execute(`N = ${n}\n${main}`);const actual=(r.variables.get('Answer') ?? r.lastResult),expected=expectedValues.get(n);if(actual!==expected)throw Error(`${name} ${compilation} ${n}: ${actual} != ${expected}`);checks++;}
  console.log(JSON.stringify({name,compilation,cases:ns.length}));
 }finally{r.dispose()}
}
console.log(JSON.stringify({checks}));
