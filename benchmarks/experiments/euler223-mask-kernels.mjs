// Fresh-process worker for reusable packed mask and numeric gather paths.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const option=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const {Interpreter}=await import(pathToFileURL(resolve(option('runtime')??'packages/interpreter/out/index.js')));
const kind=option('case')??'int32',size=200000,repeats=8;
assert(['int32','int64','real','empty'].includes(kind));
const source=`use sequences
N = ${size}
V = 1 to N array
A = ${kind==='int64'?'V + 1000000000000':kind==='real'?'V / 2':'V'}
M = ${kind==='empty'?'A less 0':'(1 to N array) mod 3 equal 0'}
Answer = ${kind==='real'?'0.0':'0'}
for I in 1 to ${repeats}
  B = A filter M array
  Answer += B sum
end`;
let sum=0n;for(let i=1;i<=size;i++)if(i%3===0&&kind!=='empty')sum+=BigInt(i)+(kind==='int64'?1000000000000n:0n);
const expected=kind==='real'?String(Number(sum)*repeats/2):String(sum*BigInt(repeats));
const r=new Interpreter(()=>{},{compilation:!process.argv.includes('--reference')});
try{const start=performance.now();r.execute(source);const ms=performance.now()-start;const answer=r.variables.get('Answer');assert.equal(String(answer),String(expected));console.log(JSON.stringify({kind,ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(answer)}));}finally{r.dispose()}
