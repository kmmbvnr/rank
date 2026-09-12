import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const modules = [await import(pathToFileURL(resolve(process.argv[2]))), await import('../packages/interpreter/out/index.js')];
const runtimes = modules.map(({Interpreter}) => { const r = new Interpreter(); r.execute('use numbers\nfun named A\n return A sum\nend\nfun folded A\n return A + reduce\nend'); return r; });
const results=[];
for (const size of [1000000,2000000]) {
 const items=Array.from({length:size},(_,i)=>BigInt(i%101-50));
 const input={kind:'array',shape:[size],items};
 const expected=items.reduce((a,b)=>a+b,0n);
 const cases=runtimes.flatMap((r,version)=>['named','folded'].map(name=>({version,name,fn:r.variables.get(name),samples:[]})));
 for (const c of cases) for(let i=0;i<3;i++)assert.equal(c.fn.call([input]),expected);
 for(let i=0;i<9;i++)for(const c of i%2?[...cases].reverse():cases){const t=performance.now();const v=c.fn.call([input]);c.samples.push(performance.now()-t);assert.equal(v,expected);}
 results.push({size,cases:cases.map(({version,name,samples})=>({version,name,samples,median:[...samples].sort((a,b)=>a-b)[4]}))});
}
for(const r of runtimes)r.dispose();
console.log(JSON.stringify({node:process.version,baseline:process.argv[2],results},null,2));
