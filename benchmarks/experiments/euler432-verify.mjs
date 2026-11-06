import{readFileSync}from'node:fs';
import{Interpreter}from'../../packages/interpreter/out/index.js';
import{totientPrefix}from'./euler432-oracle.mjs';
const file=process.argv[2]??'demos/euler/432_totientsum.ra',source=readFileSync(file,'utf8'),expected=totientPrefix(10000);
const cases=[...Array.from({length:26},(_,i)=>i),31,32,48,49,63,64,80,81,99,100,121,300,997,1000,4096,10000];
let checked=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}])for(const n of cases)for(const l of [0,1000]) {
 const runtime=new Interpreter(()=>{},{...options,args:[`--n=${n}`,`--l=${l}`]});
 try{runtime.execute(source);if(runtime.variables.get('Answer')!==expected[n])throw Error(`${n},${l},${JSON.stringify(options)}: ${runtime.variables.get('Answer')} != ${expected[n]}`);checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,cases,tableLimits:[0,1000],oracle:'direct factorization of each 510510*i',passed:true}));

const fixtureId=new URL('../../demos/euler/432_totientsum_test.ra',import.meta.url).pathname;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]) {
 const runtime=new Interpreter(()=>{},{...options,sourceId:fixtureId,loadModule:specifier=>{
  const id=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id,source:readFileSync(id,'utf8')};
 }});
 try{runtime.execute(readFileSync(fixtureId,'utf8'));if(runtime.testResults.length!==3||runtime.testResults.some(t=>!t.passed))throw Error(JSON.stringify(runtime.testResults));}finally{runtime.dispose();}
}
console.log(JSON.stringify({fixtureTestsPerMode:3,modes:3,passed:true}));
