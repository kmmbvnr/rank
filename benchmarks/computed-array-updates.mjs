import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import assert from 'node:assert/strict';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
 const match = /^--(root|case|samples|instrument)=(.+)$/.exec(arg);
 assert(match, `Unknown argument: ${arg}`);
 return [match[1], match[2]];
}));
const root=resolve(options.root??fileURLToPath(new URL('..',import.meta.url)));
const samples=Number(options.samples??5);
assert(Number.isSafeInteger(samples)&&samples>=3);
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(resolve(root,'packages/interpreter/out/index.js')));
const {typedArray,readArrayItem}=await import(pathToFileURL(resolve(root,'packages/interpreter/out/array-storage.js')));
const med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const n=1000000;
let divisorSum=2;for(let d=1;d*2<n;d++)divisorSum+=d*(Math.floor((n-1)/d)-1);
const p=200000,phi=Uint32Array.from({length:p},(_,i)=>i);for(let d=2;d<p;d++)if(phi[d]===d)for(let k=d;k<p;k+=d)phi[k]-=phi[k]/d;
const rows=256,cols=1024,input=Float64Array.from({length:rows*cols},(_,i)=>i%cols+0.5+Math.floor(i/cols));let rowSum=0;for(let i=0;i<input.length;i++)rowSum+=input[i]-(i>=cols?0.25*input[i%cols]:0);
const cases={
 divisors:{source:`use sequences\nuse numbers\nLimit = ${n}\nSums = array shape Limit fill 1\nfor D in 2 to ((Limit - 1) isqrt)\n K = D to (Limit - 1) // D array\n At' = D * K\n Sums At += D + K\n Sums (D * D) -= D\nend\nAnswer = Sums sum`,expected:BigInt(divisorSum)},
 phi:{source:`use sequences\nuse numbers\nLimit = ${p}\nPhi = 0 till Limit array\nfor P in primes till Limit\n At = P till Limit by P array\n Phi At -= Phi At // P\nend\nAnswer = Phi sum`,expected:BigInt(phi.reduce((a,b)=>a+b,0))},
 rows:{input:()=>typedArray(input.slice(),[rows,cols]),source:`use sequences\nWork = Input\nSource = 0\nFactor = 0.25\nfor Row in 1 till ${rows}\n Work Row -= Factor * Work Source\nend\nAnswer = Work sum`,expected:rowSum},
 rref:{input:()=>typedArray(Float64Array.from({length:64*64},(_,i)=>Math.floor(i/64)===i%64?2:0.001),[64,64]),init:readFileSync(resolve(root,'demos/deepml/048_rref.ra'),'utf8'),source:'Result = Input rref',verify:r=>{const a=r.variables.get('Result');for(let i=0;i<64*64;i++)if(Math.abs(Number(readArrayItem(a,i))-(Math.floor(i/64)===i%64?1:0))>1e-10)throw Error('RREF');}},
 amicable:{args:['--limit','1000000'],source:readFileSync(resolve(root,'demos/euler/021_amicable_sieve.ra'),'utf8'),expected:25275024n}
};
assert(!options.case||options.case in cases);
console.log(JSON.stringify({metadata:{root,node:process.version,cpu:cpus()[0]?.model,samples,warmups:3,
 timing:'One interpreter per case, three warmups. Includes execution, input allocation and oracle checks; excludes startup/imports and initial RREF declaration. Instrumentation is separate.',
 sourceHashes:Object.fromEntries(Object.entries(cases).map(([name,c])=>[name,createHash('sha256').update((c.init??'')+c.source).digest('hex')]))}}));
for(const [name,c]of Object.entries(cases)){
 if(options.case&&options.case!==name)continue;
 const times=[];const r=new Interpreter(()=>{},{args:c.args});if(c.init)r.execute(c.init);
 const run=()=>{if(c.input)r.variables.set('Input',c.input());r.execute(c.source);if(c.verify)c.verify(r);else if(r.variables.get('Answer')!==c.expected)throw Error(`${name}: ${r.variables.get('Answer')} != ${c.expected}`);};
 for(let i=0;i<samples+3;i++){const t=performance.now();run();if(i>=3)times.push(performance.now()-t);}
 const d=new RuntimeDiagnostics();if(options.instrument)d.run(run);r.dispose();
 console.log(JSON.stringify({name,medianMs:med(times),samples:times,...(options.instrument?{diagnostics:d}:{})}));
}
