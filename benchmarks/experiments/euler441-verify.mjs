import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const id=new URL('../../demos/euler/441_inversesum_test.ra',import.meta.url).pathname;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]){
 const runtime=new Interpreter(()=>{},{...options,sourceId:id,loadModule:specifier=>{const file=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id:file,source:readFileSync(file,'utf8')};}});
 try{runtime.execute(readFileSync(id,'utf8'));if(runtime.testResults.length!==4||runtime.testResults.some(t=>!t.passed))throw Error(JSON.stringify(runtime.testResults));}finally{runtime.dispose();}
}
console.log(JSON.stringify({fixtureTestsPerMode:4,modes:3,passed:true}));
