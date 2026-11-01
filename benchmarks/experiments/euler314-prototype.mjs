// Research only: copy the built runtime; production sources remain untouched.
import {cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'), out=resolve(process.argv[2]);
const baseline=process.env.RANK314_BASELINE_ROOT ? resolve(process.env.RANK314_BASELINE_ROOT) : root;
mkdirSync(out,{recursive:true});
for(const pkg of ['interpreter','language']) {
 const dest=resolve(out,'packages',pkg); mkdirSync(dest,{recursive:true});
 cpSync(resolve(baseline,'packages',pkg,'out'),resolve(dest,'out'),{recursive:true});
 cpSync(resolve(baseline,'packages',pkg,'package.json'),resolve(dest,'package.json'));
}
symlinkSync(resolve(root,'node_modules'),resolve(out,'node_modules'),'dir');
const local=resolve(out,'packages/interpreter/node_modules/@arrrank');
mkdirSync(local,{recursive:true}); symlinkSync('../../../language',resolve(local,'language'),'dir');
const file=resolve(out,'packages/interpreter/out/jit/number-loop-runtime.js');
let source=readFileSync(file,'utf8').replace('typedElementKind, integer32Cells,','typedElementKind, realCells, storedOperandItems, integer32Cells,');
const marker="const compact = info.type === 'integer' ? integer32Cells(value) : undefined;";
if(!source.includes(marker)) throw Error('read-buffer source changed');
const borrowGuard=process.argv.includes('--float64-only')
 ? 'packedReal instanceof Float64Array' : 'packedReal && storedOperandItems(value)';
if(!process.argv.includes('--keep-read-copies')) source=source.replace(marker,`const packedReal = info.type === 'real' && !plan.destinations.has(name) ? realCells(value) : undefined;
            if (${borrowGuard}) { buffers[info.slot] = packedReal; sources[info.slot] = value; input[info.slot] = value; continue; }
            ${marker}`);
writeFileSync(file,source);
if(process.argv.includes('--cache-capabilities')) {
 const file=resolve(out,'packages/interpreter/out/function-invocation.js');
 let source=readFileSync(file,'utf8');
 const from='return resolveCompilerCapabilities(this.options());';
 if(!source.includes(from)) throw Error('capability getter changed');
 source=source.replace(from,`const options = this.options();
        if (this.cachedCompilerOptions !== options) {
            this.cachedCompilerOptions = options;
            this.cachedCompilerResult = resolveCompilerCapabilities(options);
        }
        return this.cachedCompilerResult;`);
 writeFileSync(file,source);
}
if(process.argv.includes('--arity-seven')) {
 // Isolate rest/spread cost for cross(), whose arity is seven. This is NOT a
 // general implementation: delivery would generate the actual proven arity.
 const file=resolve(out,'packages/interpreter/out/function-invocation.js');
 let source=readFileSync(file,'utf8');
 const start=source.indexOf('run.numberDirect = (...arguments_) => {');
 const end=source.indexOf('\n        if (kernel.rankedCalls.length',start);
 if(start<0 || end<0) throw Error('Number wrapper source changed');
 const args=Array.from({length:7},(_,i)=>`a${i}`).join(',');
 let part=source.slice(start,end).replace('(...arguments_)',`(${args})`)
  .replace('rawNumber(...arguments_)',`rawNumber(${args})`)
  .replace('arguments_.map(BigInt)',`[${args}].map(BigInt)`);
 writeFileSync(file,source.slice(0,start)+part+source.slice(end));
}
console.log(resolve(out,'packages/interpreter/out/index.js'));
