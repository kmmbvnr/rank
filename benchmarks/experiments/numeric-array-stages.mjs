import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {Interpreter, RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME
 ? pathToFileURL(process.env.RANK_BENCH_RUNTIME).href
 : new URL('../../packages/interpreter/out/index.js',import.meta.url).href);
const [variant='real-matrix',mode='compiled',roundText='12']=process.argv.slice(2);
const rounds=Number(roundText);
assert(Number.isSafeInteger(rounds)&&rounds>0&&rounds<=120);
const real=variant.startsWith('real-');
assert(['integer-matrix','real-matrix','real-broadcast'].includes(variant));
const a=variant==='real-broadcast'?'64 1 64':'512 512';
const b=variant==='real-broadcast'?'1 64 1':a;
const source=`A = array shape ${a} fill ${real?'1.25':'2'}
B = array shape ${b} fill ${real?'2.5':'3'}
C = A
Total = ${real?'0.0':'0'}
for I in 1 to ${rounds}
 C = (A + B) * 2 - A
 Total += C sum
end`;
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{
 if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 const ms=performance.now()-start;
 const answer=Number(runtime.variables.get('Total'));
 assert.equal(answer,262144*rounds*(real?6.25:8));
 console.log(JSON.stringify({variant,mode,rounds,answer,ms,rssMiB:process.resourceUsage().maxRSS/1024,
  ...(process.env.DIAGNOSTICS?{diagnostics}: {})}));
}finally{runtime.dispose();}
