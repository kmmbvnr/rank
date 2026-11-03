import{readFileSync}from'node:fs';
import{resolve,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import assert from'node:assert/strict';
const{Interpreter}=await import(process.env.RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
let checks=0;
for(const name of ['362_squarefree','364_distance'])for(const compilation of [false,true]){
 const fixture=fileURLToPath(new URL(`../demos/euler/${name}_test.ra`,import.meta.url));
 const runtime=new Interpreter(()=>{},{compilation,testing:true,sourceId:fixture,loadModule(specifier,from){
  const id=resolve(dirname(from??fixture),specifier.endsWith('.ra')?specifier:specifier+'.ra');
  return{id,source:readFileSync(id,'utf8')};
 }});
 try{runtime.execute(readFileSync(fixture,'utf8'));assert.equal(runtime.testResults.length,name==='362_squarefree'?1:4);assert(runtime.testResults.every(t=>t.passed),JSON.stringify(runtime.testResults));checks+=runtime.testResults.length}finally{runtime.dispose()}
}
console.log(JSON.stringify({checks,status:'passed'}));
