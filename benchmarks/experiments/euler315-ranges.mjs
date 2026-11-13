import {readFileSync,writeFileSync} from 'node:fs';
import {primeRange} from './euler315-oracle.mjs';
const {Interpreter}=await import(process.env.RANK_BENCH_RUNTIME || new URL('../../packages/interpreter/out/index.js',import.meta.url).href);
const ranges=[[-10,10],[0,0],[0,10],[2,3],[10,11],[100,200],[101,101],[200,100],[9990,10020],[100000,101000],[10000000,10000100]];
const expected=ranges.map(([from,to])=>primeRange(from,to)),results=[];
for(const variant of ['original','overlap','table','split','array','chunk100','chunk1000','chunk10000','captured-len','captured-bound','argument-len','array-lazy','mapped','production']) {
 const source=readFileSync(new URL(variant === 'production' ? '../../demos/euler/315_digitalclocks.ra' : `./euler315-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [true,false]) for(let i=0;i<ranges.length;i++) {
  const [from,to]=ranges[i],r=new Interpreter(()=>{},{compilation});
  try {
   r.execute(source.replace('arg From integer = 10000000',`arg From integer = ${from}`).replace('arg To integer = 20000000',`arg To integer = ${to}`));
   const answer=String((r.variables.get('Answer') ?? r.lastResult));
   if(answer!==String(expected[i].answer)) throw Error(`${variant}/${compilation}/${from}/${to}: ${answer} != ${expected[i].answer}`);
   results.push({variant,compilation,from,to,answer});
  } finally {r.dispose();}
 }
}
writeFileSync(process.argv[2],JSON.stringify(results,null,2)+'\n');
console.log(results.length+' independent prime-range comparisons passed');
