import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
const [variant='bounded',mode='compiled']=process.argv.slice(2);
const source=readFileSync(new URL(variant==='shipping'?'../demos/euler/291_panaitopolprimes.ra':`./experiments/euler291-${variant}.ra`,import.meta.url),'utf8');
function prime(n){if(n<2)return false;for(let p=2;p*p<=n;p++)if(n%p===0)return false;return true;}
function oracle(limit){let count=0;for(let n=1;2*n*(n+1)+1<limit;n++)if(prime(2*n*(n+1)+1))count++;return count;}
const limits=[0,1,2,4,5,6,12,13,14,25,26,41,42,100,1000,10000,100000,1000000];
for(let n=1;n<35;n++)if(prime(2*n*(n+1)+1))for(const d of [-1,0,1])limits.push(2*n*(n+1)+1+d);
const failures=[];
for(const limit of [...new Set(limits)]){
 const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'});
 try{runtime.execute(source.replace(/arg Limit integer = \d+/,`arg Limit integer = ${limit}`)); const actual=String(runtime.variables.get('Answer')), expected=String(oracle(limit));if(actual!==expected)failures.push({limit,actual,expected});}
 catch(e){failures.push({limit,error:String(e)});}finally{runtime.dispose();}
}
console.log(JSON.stringify({variant,mode,cases:new Set(limits).size,failures}));
if(variant!=='original')assert.equal(failures.length,0);
