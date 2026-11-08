import { pathToFileURL } from 'node:url';
const chosen=process.env.RANK487_RUNTIME;
const base=chosen?pathToFileURL(chosen):new URL('../../packages/interpreter/out/index.js',import.meta.url);
const {Interpreter}=await import(base), {readArrayItem}=await import(new URL('array-storage.js',base));
const [mode='array-wide']=process.argv.slice(2), scalar=mode.startsWith('scalar'), modulus=mode.endsWith('wide')?2000000011n:1000000007n;
const count=scalar?10000:131072, r=new Interpreter(()=>{}, {scalarEntryCompilation:false}), times=[];
try {
 r.execute(`use numbers\nuse sequences\nMod = ${modulus}\nCount = ${count}\nInput = (0 till Count) copy\nfun Base Exponent raised Mod\n return Base Exponent Mod powmod\nend`);
 const source=scalar?'Total = 0\nfor I in 1 to Count\n Total += I 10000 raised Mod\nend':'Answer = Input 10000 Mod powmod';
 for(let round=0;round<7;round++) {const start=performance.now();r.execute(source);times.push(performance.now()-start);}
 let checksum;
 if(scalar) checksum=String(r.variables.get('Total'));
 else {
  let b=BigInt(count-1),e=10000n,v=1n;
  while(e) {if(e%2n)v=v*b%modulus;b=b*b%modulus;e/=2n;}
  const actual=readArrayItem(r.variables.get('Answer'),count-1);if(actual!==v)throw Error('Wrong answer');checksum=String(actual);
 }
 const sorted=times.slice(2).sort((a,b)=>a-b);
 console.log(JSON.stringify({mode,node:process.version,arch:process.arch,count,modulus:String(modulus),times,medianMs:sorted[2],rssMiB:process.resourceUsage().maxRSS/1024,checksum}));
} finally {r.dispose();}
