import {readFileSync} from 'node:fs';
import {Interpreter,isRankArray} from '../../packages/interpreter/out/index.js';
import {readArrayItem} from '../../packages/interpreter/out/array-storage.js';
import {connectedCounts,squareTotal,bruteConnected} from './euler434-oracle.mjs';
const source=readFileSync('demos/euler/434_rigidgrid.ra','utf8'),expected=connectedCounts(65);
for(let m=1;m<=4;m++)for(let n=1;n<=4;n++)if(expected[m][n]!==bruteConnected(m,n))throw Error('oracle disagreement');
for(let p=2;p*p<=1000000033;p++)if(1000000033%p===0)throw Error('normalization modulus is not prime');
const cases=[...Array.from({length:13},(_,i)=>i),25,31,32,63,64,65];let checked=0,cells=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]){
 for(const n of [...cases,100]){const r=new Interpreter(()=>{},{...options,args:[`--n=${n}`]});try{r.execute(source);const answer=n===100?863253606n:squareTotal(expected,n);if((r.variables.get('Answer') ?? r.lastResult)!==answer)throw Error('total '+n);const rows=r.variables.get('Rg');if(!isRankArray(rows))throw Error('matrix');for(let m=1;m<=n;m++)for(let q=1;q<=n;q++){const value=readArrayItem(rows,m*(n+1)+q);const wanted=n===100?readArrayItem(rows,q*(n+1)+m):expected[m][q];if(value!==wanted)throw Error(`cell ${n} ${m} ${q}`);cells++;}checked++;}finally{r.dispose();}}
 const id=new URL('../../demos/euler/434_rigidgrid_test.ra',import.meta.url).pathname;
 const r=new Interpreter(()=>{},{...options,sourceId:id,loadModule:specifier=>{const file=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id:file,source:readFileSync(file,'utf8')};}});
 try{r.execute(readFileSync(id,'utf8'));if(r.testResults.length!==3||r.testResults.some(x=>!x.passed))throw Error(JSON.stringify(r.testResults));}finally{r.dispose();}
}
console.log(JSON.stringify({checked,cells,bruteGraphShapes:16,modulusPrime:true,fixtureTestsPerMode:3,modes:3,passed:true}));
