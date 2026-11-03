import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const {Interpreter}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const root=fileURLToPath(new URL('../',import.meta.url));
function brute(r){let total=0;for(let x=0;x<=r;x++)for(let y=0;y*y<=r*r-x*x;y++){const z2=r*r-x*x-y*y,z=Math.floor(Math.sqrt(z2));if(z*z===z2)total+=(x+y+z)*(x?2:1)*(y?2:1)*(z?2:1)}return BigInt(total)}
let checks=0;
for(const compilation of [false,true]){
 for(const file of ['demos/euler/360_sphere.ra','benchmarks/experiments/euler360-original.ra','benchmarks/experiments/euler360-quarter-helper.ra','benchmarks/experiments/euler360-quarter-inline.ra']){
  const src=readFileSync(resolve(root,file),'utf8');
  for(const radius of [1,5,25,125,625]){
   const r=new Interpreter(()=>{}, {compilation});try{r.execute(src.replace('Answer = 2 ** 10 * (5 ** 10 sphere)',`Answer = ${radius} sphere`));assert.equal(r.variables.get('Answer'),brute(radius),`${file}: ${compilation}, ${radius}`);checks++;}finally{r.dispose()}
  }
 }
 const fixture=resolve(root,'demos/euler/360_sphere_test.ra');
 const r=new Interpreter(()=>{},{compilation,testing:true,sourceId:fixture,loadModule(specifier,from){const id=resolve(dirname(from??fixture),specifier.endsWith('.ra')?specifier:specifier+'.ra');return{id,source:readFileSync(id,'utf8')}}});
 try{r.execute(readFileSync(fixture,'utf8'));assert.equal(r.testResults.length,1);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));checks++;}finally{r.dispose()}
}
console.log(JSON.stringify({checks,status:'passed',oracle:'independent first-octant coordinate enumeration'}));
