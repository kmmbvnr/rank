import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK350_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const gcd=(a,b)=>b?gcd(b,a%b):a;
const cases=[];
for(let l=1;l<=12;l++)for(let n=1;n<=4;n++){
 const exact=Array(l+1).fill(0n);
 function visit(left,g,m){
  if(!left){exact[g]++;return;}
  for(let a=1;a<=l;a++){const next=m*a/gcd(m,a);if(next<=l)visit(left-1,gcd(g,a),next);}
 }
 visit(n,0,1);
 let sum=0n;for(let g=l;g>=1;g--){sum+=exact[g];cases.push([g,l,n,sum]);}
}
for(const n of [1,2,3])cases.push([10,5,n,0n]);
let checks=0;
for(const file of ['original','library','reduced','guarded','guarded-reduced','delivered'])for(const compilation of [false,true]){
 const src=readFileSync(new URL(file==='delivered'?'../demos/euler/350_constraining.ra':`./experiments/euler350-${file}.ra`,import.meta.url),'utf8');
 const r=new Interpreter(()=>{},{compilation});
 try{r.execute(src.slice(0,src.indexOf('\nAnswer =')));
 for(const [g,l,n,answer] of cases){assert.equal(r.execute(`${g} ${l} ${n} constrained`),answer,`${file} ${compilation}: ${g},${l},${n}`);checks++;}
 }finally{r.dispose();}
}
console.log(JSON.stringify({cases:cases.length,checks,oracle:'enumerate ordered tuples; compute gcd/lcm independently',engines:[false,true]}));
