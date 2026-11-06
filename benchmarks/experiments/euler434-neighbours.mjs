import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
let fixtures=0,smallRuns=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]){
 for(const name of ['344_silverdollar_test','654_neighbourlyconstraints_test']){
  const id=new URL(`../../demos/euler/${name}.ra`,import.meta.url).pathname;
  const r=new Interpreter(()=>{},{...options,sourceId:id,loadModule:specifier=>{const file=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id:file,source:readFileSync(file,'utf8')};}});
  try{r.execute(readFileSync(id,'utf8'));if(!r.testResults.length||r.testResults.some(x=>!x.passed))throw Error(JSON.stringify(r.testResults));fixtures+=r.testResults.length;}finally{r.dispose();}
 }
 for(const[name,arg,answer]of [['648_skippingsquares','--n=10','53964'],['648_skippingsquares','--n=50','842418857'],['709_evenstevens','--order=4','5'],['709_evenstevens','--order=8','1385']]){
  const r=new Interpreter(()=>{},{...options,args:[arg]});try{r.execute(readFileSync(`demos/euler/${name}.ra`,'utf8'));if(String(r.variables.get('Answer'))!==answer)throw Error(name);smallRuns++;}finally{r.dispose();}
 }
}
console.log(JSON.stringify({fixtureTests:fixtures,smallRuns,modes:3,passed:true}));
