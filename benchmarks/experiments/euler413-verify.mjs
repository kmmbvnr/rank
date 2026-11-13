import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const original=readFileSync(new URL('./euler413-original.ra',import.meta.url),'utf8');
const generated='/tmp/rank413-verified-lookup.ra';
const result=spawnSync(process.execPath,['benchmarks/euler413-investigation.mjs','compiled','19','lookup'],{env:{...process.env,RANK413_SOURCE:generated},encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
const lookup=readFileSync(generated,'utf8');
// Independent direct decimal-substring oracle, without DP or remainder states.
let brute=0;const totals=[0];
for(let n=1;n<=5;n++){
 for(let value=10**(n-1);value<10**n;value++){
  const digits=String(value);let hits=0;
  for(let a=0;a<n;a++)for(let b=a+1;b<=n;b++)if(Number(digits.slice(a,b))%n===0)hits++;
  if(hits===1)brute++;
 }
 totals.push(brute);
}
let checked=0;
for(let n=0;n<=11;n++){
 let expected=totals[n]===undefined?undefined:BigInt(totals[n]);
 for(const compilation of [false,true])for(const src of [original,lookup,readFileSync(new URL('../../demos/euler/413_onechild.ra',import.meta.url),'utf8')]){
  const r=new Interpreter(()=>{},{compilation,args:[`--digits=${n}`]});
  try{r.execute(src);const answer=(r.variables.get('Answer') ?? r.lastResult);if(expected===undefined)expected=answer;assert.equal(answer,expected,`digits=${n}, compiled=${compilation}, lookup=${src===lookup}`);checked++;}finally{r.dispose();}
 }
 if(n===7)assert.equal(expected,277674n);
 if(n===11)assert.equal(expected,86585017n);
}
console.log(JSON.stringify({checked,bruteTotals:totals}));
