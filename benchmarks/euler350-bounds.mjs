import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const{Interpreter}=await import(process.env.RANK350_RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
let checks=0;
for(const file of ['original','guarded','guarded-reduced','delivered']){
 const r=new Interpreter(()=>{});
 try{const src=readFileSync(new URL(file==='delivered'?'../demos/euler/350_constraining.ra':`./experiments/euler350-${file}.ra`,import.meta.url),'utf8');r.execute(src.slice(0,src.indexOf('\nAnswer =')));
 for(const top of [1048575,1048576,1100000]){assert.equal(r.execute(`1 ${top} 1 constrained`),BigInt(top));checks++;}
 }finally{r.dispose();}
}
console.log(JSON.stringify({checks,oracle:'N=1 => every singleton G..L qualifies',tops:[1048575,1048576,1100000]}));
