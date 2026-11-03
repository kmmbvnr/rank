import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{resolve,dirname}from'node:path';
import{fileURLToPath}from'node:url';
const{Interpreter}=await import(process.env.RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const max=10000,ways=new Int32Array(max+1),factors=[];
for(let n=2;n<=max;n++){let sf=true;for(let d=2;d*d<=n;d++)if(n%(d*d)===0){sf=false;break}if(sf)factors.push(n)}
function visit(product,start){for(let i=start;i<factors.length;i++){const p=product*factors[i];if(p>max)break;ways[p]++;visit(p,i)}}visit(1,0);
for(let n=1;n<=max;n++)ways[n]+=ways[n-1];assert.equal(ways[100],193);
let checks=0;
for(const variant of ['production','best','bound2','count-helper'])for(const compilation of [false,true])for(const limit of [0,1,2,3,4,5,10,30,100,200,1000,10000]){const r=new Interpreter(()=>{},{compilation,args:['--limit',String(limit)]});try{assert.equal(r.execute(readFileSync(new URL(variant==='production'?'../demos/euler/362_squarefree.ra':`./experiments/euler362-${variant}.ra`,import.meta.url),'utf8')),BigInt(ways[limit]),`${variant}, ${compilation}, ${limit}`);checks++}finally{r.dispose()}}
const fixture=fileURLToPath(new URL('../demos/euler/362_squarefree_test.ra',import.meta.url));
for(const variant of ['production','best','bound2','count-helper'])for(const compilation of [false,true]){
 const runtime=new Interpreter(()=>{},{compilation,testing:true,sourceId:fixture,loadModule(specifier,from){
  const id=resolve(dirname(from??fixture),specifier.endsWith('.ra')?specifier:specifier+'.ra');
  return{id,source:specifier.includes('362_squarefree')?readFileSync(new URL(variant==='production'?'../demos/euler/362_squarefree.ra':`./experiments/euler362-${variant}.ra`,import.meta.url),'utf8'):readFileSync(id,'utf8')};
 }});
 try{runtime.execute(readFileSync(fixture,'utf8'));assert.equal(runtime.testResults.length,1);assert(runtime.testResults.every(t=>t.passed),JSON.stringify(runtime.testResults));checks++}finally{runtime.dispose()}
}
console.log(JSON.stringify({checks,status:'passed',oracle:'independent enumeration of nondecreasing squarefree-factor products'}));
