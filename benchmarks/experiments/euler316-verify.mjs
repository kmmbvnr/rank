import {readFileSync,writeFileSync} from 'node:fs';
import {markovWaiting,stringWaiting,sumWaiting} from './euler316-oracle.mjs';
const [output,kind='individual']=process.argv.slice(2);
if(kind==='full') {
 const answer=sumWaiting(999999,10000000000000000n);if(answer!==542934735751917735n)throw Error('full string sum');
 if(sumWaiting(999,1000000n)!==27280188n)throw Error('statement sum');
 writeFileSync(output,JSON.stringify({answer:String(answer),statement:'27280188',method:'String border sum; individual formula verified by separate exact Markov-chain oracle'},null,2)+'\n');
 console.log(String(answer));
} else {
 const runtimeUrl=process.env.RANK_BENCH_RUNTIME || new URL('../../packages/interpreter/out/index.js',import.meta.url).href;
 const {Interpreter,RuntimeDiagnostics}=await import(runtimeUrl);
 const {ownedArray,arrayValues}=await import(new URL('./array-storage.js',runtimeUrl.startsWith('/')?'file://'+runtimeUrl:runtimeUrl));
 const variants=['original','grouped','carried','carried-postfix','original-function','carried-postfix-function','grouped-function'];
 const cases=Array.from({length:1000},(_,i)=>BigInt(i));let seed=316;
 for(let i=0;i<96;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;cases.push(BigInt(seed)*23456789n+17n);}
 cases.push(9999n,10000n,535n,1111n,1212n,10101n,9007199254740991n,9007199254740992n,9007199254740993n,10n**40n-1n,10n**40n,10n**40n+137n,-1n);
 const expected=cases.map(markovWaiting);
 expected.forEach((v,i)=>{if(v!==stringWaiting(cases[i]))throw Error('independent formula mismatch at '+cases[i]);});
 const result={cases:cases.length,checks:0,samples:[]};
 for(const variant of variants) for(const compilation of [true,false]) {
  let source=readFileSync(new URL(`./euler316-${variant}.ra`,import.meta.url),'utf8');
  const cut=source.indexOf('\nfun '),head=source.slice(0,cut),body=source.slice(cut);
  const start=head.search(/^(Answer|Power) =/m);source=head.slice(0,start)+body;
  const r=new Interpreter(()=>{},{compilation}),d=new RuntimeDiagnostics();
  try {
   d.run(()=>r.execute(source));r.variables.set('Cases',ownedArray([...cases],[cases.length],true));
   d.run(()=>r.execute('Results = (Cases waiting rank 0) array'));
   const actual=[...arrayValues(r.variables.get('Results'))];if(actual.length!==expected.length)throw Error('shape');
   actual.forEach((v,i)=>{if(v!==expected[i])throw Error(`${variant}/${compilation}: ${cases[i]}: ${v} != ${expected[i]}`);});
   result.checks+=actual.length;result.samples.push({variant,compilation,passed:actual.length,rejections:d.compilerRejections});
   writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  } finally {r.dispose();}
 }
 console.log(result.checks+' exact Markov-pattern comparisons passed');
}
