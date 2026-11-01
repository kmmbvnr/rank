import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const root=process.env.RANK_ROOT||process.cwd();
const {Interpreter}=await import(root+'/packages/interpreter/out/index.js');
const file=resolve(root,'demos/euler/318_nines_test.ra'),results=[];
for(const compilation of [true,false]) {
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:file,loadModule(specifier,from) {
  const id=resolve(dirname(from??file),specifier+'.ra');return {id,source:readFileSync(id,'utf8')};
 }});
 try{r.execute(readFileSync(file,'utf8'));results.push({compilation,tests:r.testResults});}catch(e){results.push({compilation,error:String(e)});}finally{r.dispose()}
}
console.log(JSON.stringify(results,null,2));
