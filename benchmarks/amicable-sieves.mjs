import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import assert from 'node:assert/strict';

// Build the checkout first. --root permits the same sources to run against an
// isolated baseline runtime. Timings include execute(), not startup/imports.
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
 const match = /^--(root|limit|samples|case|instrument)=(.+)$/.exec(arg);
 assert(match, `Unknown option: ${arg}`);
 return [match[1], match[2]];
}));
const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)));
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const limit = Number(options.limit ?? 10000), samples = Number(options.samples ?? 7), selected = options.case;
assert([10000, 100000, 1000000].includes(limit));
assert(Number.isSafeInteger(samples) && samples >= 3);
const imports=`use sequences\nuse numbers\nLimit = ${limit}\n`;
const finish=`Candidates = 2 till Limit array
Partners = Sums Candidates
Mask = Partners greater Candidates and Partners less Limit
A = Candidates Mask
B = Partners Mask
Answer = ((A + B) ((Sums B) equal A)) sum`;
const cases={
 pairArray:imports+`Sums = array shape Limit fill 1
for D in 2 to ((Limit - 1) isqrt)
 K = D to (Limit - 1) // D array
 At' = D * K
 Sums At += D + K
 Sums (D * D) -= D
end
`+finish,
 pairScalar:imports+`Sums = array shape Limit fill 1
for D in 2 to ((Limit - 1) isqrt)
 for K in D to (Limit - 1) // D
  Sums (D * K) += D + K
 end
 Sums (D * D) -= D
end
`+finish,
 primeScalar:imports+`Sigma = array shape Limit fill 1
for P in 2 till Limit
 if Sigma P equal 1
  for N in P till Limit by P
   Power = P
   for N mod Power equal 0
    Power *= P
   end
   Sigma N *= (Power - 1) // (P - 1)
  end
 end
end
Sums = Sigma - (0 till Limit array)
`+finish,
 primeArray:imports+`Sigma = array shape Limit fill 1
for P in primes till Limit
 Power = P
 Previous = P - 1
 for Power less Limit
  At = Power till Limit by Power array
  Next = Power * P - 1
  Sigma At *= Next
  Sigma At //= Previous
  Previous = Next
  Power *= P
 end
end
Sums = Sigma - (0 till Limit array)
`+finish,
};
const expected={10000:31626n,100000:852810n,1000000:25275024n}[limit];
assert(!selected || selected in cases, `Unknown case: ${selected}`);
console.log(JSON.stringify({ metadata: { root, limit, samples, warmups: 3, node: process.version, cpu: cpus()[0]?.model,
 timing: 'Three warmups, then repeated execute() in one interpreter per case; includes parsing/allocation/checksum, excludes startup/imports. Instrumentation is a separate run.',
 sourceHashes: Object.fromEntries(Object.entries(cases).map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')])) } }));
for(const [name,source] of Object.entries(cases)){
 if(selected && selected!==name)continue;
 const results=[];
 const runtime=new Interpreter();
 for(let i=0;i<samples+3;i++){
  const start=performance.now();runtime.execute(source);
  if(runtime.variables.get('Answer')!==expected)throw Error(`${name}: ${runtime.variables.get('Answer')}`);
  if(i>=3)results.push(performance.now()-start);
 }
 const d=new RuntimeDiagnostics();if(options.instrument)d.run(()=>runtime.execute(source));
 console.log(JSON.stringify({name,limit,answer:String(expected),medianMs:[...results].sort((a,b)=>a-b)[Math.floor(samples/2)],samples:results,...(options.instrument?{diagnostics:d}:{})}));
 runtime.dispose();
}
