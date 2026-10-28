import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {Interpreter}=await import(pathToFileURL(resolve(process.argv[2]??'packages/interpreter/out/index.js')));
let checks=0;const results=[];
for(const limit of [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,31,50,99,100,101,199,200,201,300]) {
 let expected=0;for(let a=1;a<=limit/3;a++)for(let b=a;b<=(limit-a)/2;b++){const c=Math.round(Math.sqrt(a*a+b*b-1));if(c>=b&&a+b+c<=limit&&a*a+b*b===c*c+1)expected++;}
 for(const source of ['original','canonical','canonical-eager','shipping','shipping-small-chunks'])for(const compilation of [true,false]){
  const file=source.startsWith('shipping')?new URL('../../demos/euler/223_almostright.ra',import.meta.url):new URL(`./euler223-${source}.ra`,import.meta.url);
  let code=source==='original'?JSON.parse(readFileSync(new URL('../baselines/2026-10-28-euler223-investigation.json',import.meta.url),'utf8')).originalSource:readFileSync(file,'utf8');
  if(source==='shipping-small-chunks')code=code.replace('Wd = 2000000','Wd = 8');
  const r=new Interpreter(()=>{},{compilation});try{r.execute(code.replace('arg Limit integer = 25000000',`arg Limit integer = ${limit}`));assert.equal(String(r.variables.get('Answer')),String(expected),`${source} ${limit} ${compilation}`);checks++;}finally{r.dispose()}
 }results.push({limit,expected});
}console.log(JSON.stringify({checks,results}));
