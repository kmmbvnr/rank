import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {Interpreter}=await import(pathToFileURL(resolve(process.argv[2] ?? 'packages/interpreter/out/index.js')));
const main=fileURLToPath(new URL('../../demos/euler/233_circlepoints.ra',import.meta.url));
const original=JSON.parse(readFileSync(new URL('../baselines/2026-10-28-euler233-investigation.json',import.meta.url),'utf8')).sources.original.source;
const max=20000000, sp=new Uint32Array(max+1);
for(let p=2;p<=max;p++) if(!sp[p]) { sp[p]=p; if(p*p<=max) for(let n=p*p;n<=max;n+=p) if(!sp[n]) sp[n]=p; }
const limits=[1,10000,359124,359125,359126,469624,469625,500000,999999,1000000,10000000,20000000];
const expected=new Map();let total=0n;
for(let n=1;n<=max;n++) {let m=n, count=4;while(m>1){const p=sp[m];let e=0;do {m/=p;e++;} while(m%p===0);if(p%4===1)count*=2*e+1;} if(count===420) total+=BigInt(n);if(limits.includes(n))expected.set(n,total);}
function factorCount(n) {let m=n,c=4;while(m>1){const p=sp[m];let e=0;do {m/=p;e++;}while(m%p===0);if(p%4===1)c*=2*e+1;}return c;}
function geometric(n) {let c=0;for(let x=Math.ceil((n-Math.SQRT2*n)/2);x<=Math.floor((n+Math.SQRT2*n)/2);x++){const v=2*n*n-(2*x-n)**2;const y=Math.round(Math.sqrt(v));if(y*y===v&&(n+y)%2===0)c+=y===0?1:2;}return c;}
for(let n=1;n<=1000;n++) assert.equal(factorCount(n),geometric(n));assert.equal(geometric(10000),36);
const rows=[];
for(const [file,source] of [['original',original],['shipping',readFileSync(main,'utf8')]]) for(const compilation of [false,true]) for(const limit of limits) {
 const r=new Interpreter(()=>{}, {compilation});try{r.execute(source.replace(/option Limit integer = \d+/,`option Limit integer = ${limit}`));const answer=String(r.variables.get('Answer'));assert.equal(answer,String(expected.get(limit)));rows.push({file,compilation,limit,answer});}finally{r.dispose();}
}
console.log(JSON.stringify({checks:rows.length,geometricChecks:1001,rows,expected:[...expected].map(([n,v])=>[n,String(v)])}));
