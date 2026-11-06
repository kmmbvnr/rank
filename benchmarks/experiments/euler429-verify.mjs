import{readFileSync}from'node:fs';
import{Interpreter}from'../../packages/interpreter/out/index.js';
import{unitarySquares}from'./euler429-oracle.mjs';
const file='demos/euler/429_unitary.ra',source=readFileSync(file,'utf8');
let checked=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}])for(let n=0;n<=32;n++) {
 const runtime=new Interpreter(()=>{},{...options,args:[`--n=${n}`]});
 try{runtime.execute(source);if(runtime.variables.get('Answer')!==unitarySquares(n))throw Error(`wrong n=${n}`);checked++;}finally{runtime.dispose();}
}
const fixtureId=new URL('../../demos/euler/429_unitary_test.ra',import.meta.url).pathname;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]) {
 const runtime=new Interpreter(()=>{},{...options,sourceId:fixtureId,loadModule:specifier=>{
  const id=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id,source:readFileSync(id,'utf8')};
 }});
 try{runtime.execute(readFileSync(fixtureId,'utf8'));if(runtime.testResults.length!==3||runtime.testResults.some(t=>!t.passed))throw Error(JSON.stringify(runtime.testResults));}finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,oracle:'enumeration of unitary divisors of exact factorials',fixtureModes:3,fixtureTestsPerMode:3,passed:true}));
