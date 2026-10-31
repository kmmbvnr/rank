// Same synchronous host job, explicit GC: exercise known integer argument
// signatures while releasing each completed input before creating the next.
import {pathToFileURL} from 'node:url';
const root=process.env.RANK_BENCH_RUNTIME?pathToFileURL(process.env.RANK_BENCH_RUNTIME):new URL('../../packages/interpreter/out/index.js',import.meta.url);
const {ownedArray}=await import(new URL('./array-storage.js',root));
const {setSemanticArrayType}=await import(new URL('./semantic-array-type.js',root));
const {argumentSignature}=await import(new URL('./return-contract.js',root));
if(!global.gc)throw Error('Run with --expose-gc');
const used=()=>process.memoryUsage().heapUsed+process.memoryUsage().arrayBuffers;
const type={key:JSON.stringify(['integer']),scalar:'integer'};
const key=argumentSignature([ownedArray([1n,2n])]);
global.gc();const before=used();
for(let i=0;i<2000;i++){
 const value=setSemanticArrayType(ownedArray(Array(4096).fill(BigInt(i))),type);
 if(argumentSignature([value])!==key)throw Error('Signature changed');
 if(i%200===0)global.gc();
}
global.gc();console.log(JSON.stringify({arrays:2000,cellsPerArray:4096,retainedBytes:used()-before,rssMiB:process.resourceUsage().maxRSS/1024}));
