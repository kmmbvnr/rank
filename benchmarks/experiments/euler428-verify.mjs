import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {necklacePrefix} from './euler428-oracle.mjs';
const file=process.argv[2]??'demos/euler/428_necklacetriplets.ra',source=readFileSync(file,'utf8');
const prefix=necklacePrefix(3000),cases=[...Array.from({length:26},(_,i)=>i),31,32,35,36,48,49,63,64,80,81,99,100,120,121,300,1000,3000];
let checked=0;
for(const options of [{},{numberLoopCompilation:false,arrayFunctionCompilation:false},{compilation:false}])for(const n of cases) {
 const runtime=new Interpreter(()=>{},{...options,args:[`--n=${n}`]});
 try{runtime.execute(source);if((runtime.variables.get('Answer') ?? runtime.lastResult)!==prefix[n])throw Error(`n=${n} ${JSON.stringify(options)}: ${(runtime.variables.get('Answer') ?? runtime.lastResult)} != ${prefix[n]}`);checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({file,checked,cases,checkpoints:[1,20,300,3000].map(n=>[n,String(prefix[n])]),oracle:'direct factor pairs of the three circle equations'}));
const fixtureId = new URL('../../demos/euler/428_necklacetriplets_test.ra', import.meta.url).pathname;
for (const options of [{}, {numberLoopCompilation:false,arrayFunctionCompilation:false}, {compilation:false}]) {
 const runtime=new Interpreter(()=>{},{...options,sourceId:fixtureId,loadModule:specifier=>{
  const id=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;
  return {id,source:readFileSync(id,'utf8')};
 }});
 try {
  runtime.execute(readFileSync(fixtureId,'utf8'));
  if(runtime.testResults.length!==4||runtime.testResults.some(t=>!t.passed))throw Error(JSON.stringify(runtime.testResults));
 }finally{runtime.dispose();}
}
console.log(JSON.stringify({fixture:fixtureId,modes:3,testsPerMode:4,passed:true}));
