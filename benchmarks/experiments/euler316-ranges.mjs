import {readFileSync,writeFileSync} from 'node:fs';
import {sumWaiting} from './euler316-oracle.mjs';
const {Interpreter}=await import(process.env.RANK_BENCH_RUNTIME || new URL('../../packages/interpreter/out/index.js',import.meta.url).href);
const nums=[-100000000000000000000n,-1n,0n,10n,99n,1000000n,9007199254740991n,9007199254740992n,9007199254740993n,10000000000000000n,10n**40n];
const tops=[0,1,2,9,31,999],results=[];
for(const variant of ['original','grouped','carried','carried-postfix','original-function','carried-postfix-function','grouped-function']) {
 const source=readFileSync(new URL(`./euler316-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [true,false]) for(const num of nums) for(const top of tops) {
  const expected=String(sumWaiting(top,num)),r=new Interpreter(()=>{},{compilation});
  try {
   r.execute(source.replace('arg Top integer = 999999',`arg Top integer = ${top}`).replace('arg Num integer = 10000000000000000',`arg Num integer = ${num}`));
   const answer=String(r.variables.get('Answer'));if(answer!==expected)throw Error(`${variant}/${compilation}/${num}/${top}: ${answer} != ${expected}`);
   results.push({variant,compilation,num:String(num),top,answer});
  } finally {r.dispose();}
 }
}
writeFileSync(process.argv[2],JSON.stringify(results,null,2)+'\n');console.log(results.length+' string-sum range comparisons passed');
