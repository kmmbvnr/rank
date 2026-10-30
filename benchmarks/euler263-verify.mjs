import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {Interpreter}=await import(pathToFileURL(resolve(process.env.RUNTIME ?? 'packages/interpreter/out/index.js')));
const root=fileURLToPath(new URL('../',import.meta.url)),original=resolve(root,'demos/euler/263_engineersdream.ra');
// node benchmarks/euler263-verify.mjs [original|prototype]
const variant=process.argv[2]??'original';
assert(['original','prototype'].includes(variant));
const sourceFile=fileURLToPath(new URL(variant==='original' ? './experiments/euler263-original.ra' : './experiments/euler263-scalar-practical.ra',import.meta.url));
const source=readFileSync(sourceFile,'utf8');
const rows=[];
for(const mode of ['compiled','reference']){
 const fixture=resolve(root,'demos/euler/263_engineersdream_test.ra');
 const r=new Interpreter(()=>{},{compilation:mode==='compiled',testing:true,sourceId:fixture,loadModule(spec,from){const id=resolve(dirname(from??fixture),spec.endsWith('.ra')?spec:spec+'.ra');return {id,source:id===original?source:readFileSync(id,'utf8')};}});
 try{r.execute(readFileSync(fixture,'utf8'));assert.equal(r.testResults.length,5);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));rows.push({mode,fixture:r.testResults.map(t=>({name:t.name,passed:t.passed}))});}finally{r.dispose();}
 const r2=new Interpreter(()=>{},{compilation:mode==='compiled'});
 try{
  r2.execute(source.replace('arg Count integer = 4','arg Count integer = 0'));
  r2.execute('Checks = array shape 2048 fill false\nfor X in 1 to 2048\n  Checks (X - 1) = X practical\nend');
  for(let n=1;n<=2048;n++){
   let reachable=1n;
   for(let d=1;d<=n;d++)if(n%d===0)reachable|=reachable<<BigInt(d);
   const mask=(1n<<BigInt(n+1))-1n;
   const expected=(reachable&mask)===mask;
   const actual=r2.execute(`Checks ${n-1}`);assert.equal(actual,expected,`n=${n} ${mode}`);
  }
  for(const n of [1n<<60n,3n*(1n<<59n),5n*(1n<<54n),(1n<<60n)+1n])assert.equal(r2.execute(`${n} practical`),n%2n===0n);
  rows.push({mode,subsetSumOracle:2048,largeIntegers:4});
 }finally{r2.dispose();}
}
console.log(JSON.stringify({sourceFile,rows}));
