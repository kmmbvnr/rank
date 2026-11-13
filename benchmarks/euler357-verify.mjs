import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const {Interpreter}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const prime=n=>{if(n<2)return false;for(let d=2;d*d<=n;d++)if(n%d===0)return false;return true};
const sums=[0];for(let n=1;n<=10000;n++){let ok=true;for(let d=1;d*d<=n;d++)if(n%d===0&&!prime(d+n/d)){ok=false;break} sums[n]=sums[n-1]+(ok?n:0)}
let checks=0;
for(const mode of ['compiled','reference'])for(const file of ['benchmarks/experiments/euler357-original.ra','demos/euler/357_primegenerating.ra'])for(const limit of [0,1,2,3,4,5,6,7,10,30,100,210,1000,10000]){
const r=new Interpreter(()=>{}, {compilation:mode==='compiled',args:[`--limit=${limit}`]});try{r.execute(readFileSync(file,'utf8'));assert.equal((r.variables.get('Answer') ?? r.lastResult),BigInt(sums[limit]),`${file} ${mode} ${limit}`);checks++}finally{r.dispose()}}
const fixture = fileURLToPath(new URL('../demos/euler/357_primegenerating_test.ra', import.meta.url));
for (const compilation of [false,true]) {
 const r = new Interpreter(()=>{}, {compilation,testing:true,sourceId:fixture,
 loadModule(specifier,from) {const id=resolve(dirname(from??fixture),specifier.endsWith('.ra')?specifier:specifier+'.ra');return {id,source:readFileSync(id,'utf8')}}});
 try {r.execute(readFileSync(fixture,'utf8'));assert.equal(r.testResults.length,1);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));checks++;}finally{r.dispose()}
}
console.log(JSON.stringify({checks,status:'passed',oracle:'independent divisor trial and primality'}));
