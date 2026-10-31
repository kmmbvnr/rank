import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',turns='50']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));assert(/^[a-z][a-z0-9]*$/.test(variant)&&/^\d+$/.test(turns));
const source=readFileSync(new URL(variant==='shipping'?'../demos/euler/298_selectiveamnesia.ra':`./experiments/euler298-${variant}.ra`,import.meta.url),'utf8').replace('arg Turns integer = 50',`arg Turns integer = ${turns}`);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'}),diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{
const phases=[];
if(process.env.PHASES){let begin=0;for(const marker of ['Wd = 2 * Turns + 3',"Cols' = 0 till Size array mod Wd",null]){const end=marker===null?source.length:source.indexOf(marker);assert(end>begin);const t=performance.now();diagnostics.run(()=>runtime.execute(source.slice(begin,end)));phases.push({until:marker??'end',ms:performance.now()-t});console.error(JSON.stringify(phases.at(-1)));begin=end;}}
else if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
const answer=runtime.variables.get('Answer');const known=Object.fromEntries(JSON.parse(readFileSync(new URL('./baselines/2026-10-31-euler298-oracle.json',import.meta.url),'utf8')).values.map(v=>[v.turns,v.answer]));const correct=known[turns]===undefined||answer===known[turns];
const graph=process.env.GRAPH?Object.fromEntries([['Sc',Number(runtime.variables.get('Ns'))],...['Tf','Tt','Td','Tw'].map(n=>[n,Number(runtime.variables.get('Nt'))])].map(([name,n])=>[name,Array.from({length:n},(_,i)=>Number(runtime.variables.get(name).items[i]))])):undefined;
console.log(JSON.stringify({mode,variant,turns,answer,correct,graph,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,counts:Object.fromEntries(['Ns','Nt','Size'].map(k=>[k,String(runtime.variables.get(k))])),phases,...(process.env.DIAGNOSTICS||process.env.PHASES?{diagnostics}:{})}));
}finally{runtime.dispose();}
