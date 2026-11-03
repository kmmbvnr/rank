import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
const{Interpreter}=await import(new URL(process.env.RUNTIME||'../../packages/interpreter/out/index.js',import.meta.url));
const original=readFileSync('benchmarks/experiments/euler375-original.ra','utf8'),stream=readFileSync('demos/euler/375_subseqmin.ra','utf8');
function oracle(a,n){let sum=0n;for(let i=0;i<n;i++){let low=Infinity;for(let j=i;j<n;j++){low=Math.min(low,a[j%a.length]);sum+=BigInt(low);}}return sum;}
let checks=0;
for(const compilation of[false,true]){let r=new Interpreter(()=>{},{compilation});try{
 for(let p=1;p<=20;p++){
 let s=290797n,a=[];for(let i=0;i<p;i++){s=s*s%50515093n;a.push(Number(s));}
 for(let n of new Set([0,1,p-1,p,p+1,2*p-1,2*p,2*p+1,3*p+Math.floor(p/2)])){
 let expected=oracle(a,n);
 for(let src of[original,stream]){r.execute(src.replace(/arg Limit integer = \d+/,`Limit = ${n}`).replace(/arg Period integer = \d+/,`Period = ${p}`));assert.equal(r.variables.get('Answer'),expected,`${compilation},p=${p},n=${n}`);checks++;}
 }
 }
 // Synthetic periods cover tied minima, all equal, and every minimum position.
 for(let a of[[5],[3,3,3],[1,4,2,1,5],[5,4,3,2,1],[1,2,3,4,5],[2,0,4,0,1],[4,2,1,3,5]]){
  for(let n=0;n<=3*a.length+1;n++){
   let expected=oracle(a,n);
   for(let src of[stream]){let end=src.indexOf(src===original?'Prev =':'rem A zero excess');let custom=src.slice(0,src.indexOf('Mod ='))+`A = array shape ${a.length} fill 0\n${a.map((x,i)=>`A ${i} = ${x}`).join('\n')}\nLow = ${Math.min(...a)}\nK = ${a.indexOf(Math.min(...a))}\n`+src.slice(end);r.execute(custom.replace(/arg Limit integer = \d+/,`Limit = ${n}`).replace(/arg Period integer = \d+/,`Period = ${a.length}`));assert.equal(r.variables.get('Answer'),expected);checks++;}
  }
 }
}finally{r.dispose();}}
for(const compilation of[false,true]){const r=new Interpreter(()=>{},{compilation});try{for(const src of[original,stream])for(const [n,expected]of[[10,432256955n],[10000,3264567774119n]]){r.execute(src.replace(/arg Limit integer = \d+/,`Limit = ${n}`).replace(/arg Period integer = \d+/,`Period = ${n}`));assert.equal(r.variables.get('Answer'),expected);}}finally{r.dispose();}}
console.log(JSON.stringify({checks,fixtureChecks:8,oracle:'quadratic exact contiguous-subsequence minima',status:'pass'}));
