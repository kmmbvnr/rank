import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const variants=['original','monotone','lcm','odd','odd-manual','scoped','scoped-manual','scoped-all','prime-stream','prime-reverse','delivered'];
const cases=[0,1,2,3,4,5,6,7,8,9,10,11,12,25,32,49,81,121,125,169,200,997,1000];
// Ordinary long division, independent of factoring and multiplicative orders.
let sum=0n;const expected=new Map([[0,0n]]);
for(let d=1;d<=1000;d++){
 const seen=new Int32Array(d).fill(-1);let remainder=1%d,position=0;
 while(remainder!==0&&seen[remainder]===-1){seen[remainder]=position++;remainder=remainder*10%d;}
 if(remainder!==0)sum+=BigInt(position-seen[remainder]);
 expected.set(d,sum);
}
let checked=0;
for(const variant of variants){const source=readFileSync(new URL(variant==='delivered'?'../../demos/euler/417_reciprocalcycles.ra':`./euler417-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [false,true])for(const n of cases){
  const runtime=new Interpreter(()=>{},{compilation,args:[`--n=${n}`]});
  try{runtime.execute(source);const actual=(runtime.variables.get('Answer') ?? runtime.lastResult);if(actual!==expected.get(n))throw Error(JSON.stringify({variant,compilation,n,expected:String(expected.get(n)),actual:String(actual)}));checked++;}finally{runtime.dispose();}
 }
 const runtime=new Interpreter(()=>{},{args:['--n=1000000']});
 try{runtime.execute(source);if((runtime.variables.get('Answer') ?? runtime.lastResult)!==55535191115n)throw Error(variant+' checkpoint');checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,variants,cases,oracle:'decimal long division',publishedMillion:true}));
