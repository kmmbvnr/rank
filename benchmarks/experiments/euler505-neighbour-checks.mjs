import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const files={502:'countingcastles',504:'squareinside',511:'nicesequences'};
let checks=0;
for(const [id,variant] of [[502,'convolve'],[504,'loop'],[511,'convolve']])for(const compilation of [false,true]){
 const source=readFileSync(new URL(`./euler${id}-${variant}.ra`,import.meta.url),'utf8');
 const results=[];
 const r=new Interpreter(()=>{},{compilation,loadModule:()=>({id:`case${id}`,source}),onTestResult:x=>results.push(x)});
 try{r.execute(readFileSync(new URL(`../../demos/euler/${id}_${files[id]}_test.ra`,import.meta.url),'utf8'));for(const x of results){if(!x.passed)throw Error(JSON.stringify(x));checks++;}console.log(JSON.stringify({id,variant,compilation,fixtures:results}));}finally{r.dispose()}
}
// Compare independent solution shapes on many parameter combinations.
for(const [id,variant,inputs] of [
 [504,'loop',Array.from({length:15},(_,i)=>({M:i+1}))],
 [511,'convolve',Array.from({length:24},(_,i)=>({N:i+1,K:1+i%11}))],
 [502,'convolve',Array.from({length:20},(_,i)=>({W1:1+i%7,H1:1+i%5,W2:1+(i*3)%13,H2:1+(i*7)%11,W3:1+(i*5)%17,H3:1+(i*11)%9}))]
]){
 const base=readFileSync(new URL(`./euler${id}-baseline.ra`,import.meta.url),'utf8');
 const candidate=readFileSync(new URL(`./euler${id}-${variant}.ra`,import.meta.url),'utf8');
 for(const values of inputs){
  let expected;
  for(const compilation of [false,true])for(const source of [base,candidate]){
   const r=new Interpreter(()=>{},{compilation,args:Object.entries(values).map(([k,v])=>`--${k.toLowerCase()}=${v}`)});
   try{r.execute(source);const actual=r.variables.get('Answer');if(expected===undefined)expected=actual;else if(actual!==expected)throw Error(`${id} ${JSON.stringify(values)} ${actual} != ${expected}`);checks++;}finally{r.dispose()}
  }
 }
}
console.log(JSON.stringify({checks}));
