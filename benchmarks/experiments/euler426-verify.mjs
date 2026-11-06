import { readFileSync } from 'node:fs';
import { perBallReference } from './euler426-oracle.mjs';
const { Interpreter } = await import(new URL('../../packages/interpreter/out/index.js', import.meta.url));
const source = readFileSync('demos/euler/426_boxball.ra','utf8');
const cases = [...Array.from({length:22},(_,i)=>i),31,32,63,64,100,511,512,1000,10000,100000];
let checked=0;
for(const mode of ['compiled','exact','reference']) for(const last of cases) {
 const expected=BigInt(perBallReference(last));
 const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',...(mode==='exact'?{numberLoopCompilation:false}:{}),args:[`--last=${last}`]});
 try { runtime.execute(source); if(runtime.variables.get('Answer')!==expected)throw Error(`last=${last} ${mode}: ${runtime.variables.get('Answer')} != ${expected}`);checked++; }
 finally {runtime.dispose();}
}
console.log(JSON.stringify({checked,cases,oracle:'one stack entry per ball',full:perBallReference(10000000)}));
