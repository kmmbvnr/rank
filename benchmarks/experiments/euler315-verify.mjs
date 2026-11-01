import {readFileSync,writeFileSync} from 'node:fs';
import {clockDifference,primeRange} from './euler315-oracle.mjs';
const [output,kind='small']=process.argv.slice(2);
if(kind==='full') {
 const start=performance.now(),oracle=primeRange(10000000,20000000);
 if(oracle.answer!==13625242) throw Error('full independent oracle mismatch');
 writeFileSync(output,JSON.stringify({...oracle,ms:performance.now()-start},null,2)+'\n');
 console.log(JSON.stringify(oracle));
} else {
 const runtimeUrl=process.env.RANK_BENCH_RUNTIME || new URL('../../packages/interpreter/out/index.js',import.meta.url).href;
 const {Interpreter,RuntimeDiagnostics}=await import(runtimeUrl);
 const {ownedArray,arrayValues}=await import(new URL('./array-storage.js',runtimeUrl.startsWith('/')?'file://'+runtimeUrl:runtimeUrl));
 const variants=['original','overlap','table','split','array','chunk1000','captured-len','captured-bound','argument-len','production'];
 const cases=Array.from({length:1000},(_,i)=>BigInt(i));let seed=315;
 for(let i=0;i<256;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;cases.push(BigInt(seed)*1009n);}
 cases.push(9999n,10000n,10000000n,20000000n,9007199254740991n,9007199254740992n,
  10n**40n-1n,10n**40n,10n**40n+137n,-1n);
 const expected=cases.map(n=>BigInt(clockDifference(n))),result={caseCount:cases.length,checks:0,samples:[]};
 for(const variant of variants) for(const compilation of [true,false]) for(const bound of [3,20000000]) {
  let source=readFileSync(new URL(variant === 'production' ? '../../demos/euler/315_digitalclocks.ra' : `./euler315-${variant}.ra`,import.meta.url),'utf8')
   .replace('arg From integer = 10000000','arg From integer = 2').replace('arg To integer = 20000000',`arg To integer = ${bound}`);
  const cut=source.indexOf('\nfun '),head=source.slice(0,cut),body=source.slice(cut);
  const start=[head.indexOf('Answer = 0'),head.indexOf('Ps = ')].filter(n=>n>=0).sort((a,b)=>a-b)[0];
  source=head.slice(0,start)+body;
  const r=new Interpreter(()=>{},{compilation}),diagnostics=new RuntimeDiagnostics();
  try {
   diagnostics.run(()=>r.execute(source));r.variables.set('Cases',ownedArray([...cases],[cases.length],true));
   const call=variant==='argument-len'?'Cases clock_diff Small rank 0 1':'Cases clock_diff rank 0';
   diagnostics.run(()=>r.execute(`Results = (${call}) array`));
   const values=[...arrayValues(r.variables.get('Results'))];
   if(values.length!==expected.length) throw Error(`${variant} shape`);
   values.forEach((v,i)=>{if(v!==expected[i])throw Error(`${variant}/${compilation}/To=${bound}: ${cases[i]}: ${v} != ${expected[i]}`);});
   if(r.execute('137 segments')!==11n) throw Error('statement segments');
   result.checks+=values.length;
   result.samples.push({variant,compilation,bound,passed:values.length,rejections:diagnostics.compilerRejections});
   writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  } finally {r.dispose();}
 }
 console.log(result.checks+' independent display-simulation comparisons passed');
}
