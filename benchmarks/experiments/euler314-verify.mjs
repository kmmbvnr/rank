import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),results=[];
const [borrow,arity,cache,cacheBorrow,output]=process.argv.slice(2);
const cases=[['current','original',undefined,'compiled'],['reference','original',undefined,'reference'],
 ['continuous','continuous',undefined,'compiled'],['borrow','original',borrow,'compiled'],
 ['borrow-continuous','continuous',borrow,'compiled'],['borrow-inline','inline',borrow,'compiled'],
 ['borrow-arity','original',arity,'compiled'],['cache','original',cache,'compiled'],
 ['cache-continuous','continuous',cache,'compiled'],['cache-borrow','original',cacheBorrow,'compiled'],
 ['cache-borrow-continuous','continuous',cacheBorrow,'compiled']];
for(const grid of [1,2,3,5,10,15,25]) for(const [name,variant,runtime,mode] of cases) {
 const child=spawnSync(process.execPath,[resolve(root,'benchmarks/euler314-investigation.mjs'),mode,String(grid),variant],
  {encoding:'utf8',timeout:60000,env:{...process.env,...(runtime?{RANK_BENCH_RUNTIME:resolve(runtime)}:{})}});
 if(child.status!==0) throw Error(name+' '+grid+' '+(child.stderr || String(child.error)));
 const sample=JSON.parse(child.stdout);results.push({name,grid,answer:sample.answer});
 writeFileSync(output,JSON.stringify(results,null,2)+'\n');
}
console.log(results.length+' independent oracle comparisons passed');
