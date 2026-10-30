import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',limit='100000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
let source=readFileSync(new URL('./experiments/euler276-original.ra',import.meta.url),'utf8');
if(variant==='shipping')source=readFileSync(new URL('../demos/euler/276_primitivetriangles.ra',import.meta.url),'utf8');
else if(variant!=='original')source=readFileSync(new URL(`./experiments/euler276-${variant}.ra`,import.meta.url),'utf8');
source=source.replace('arg Limit integer = 10000000',`arg Limit integer = ${limit}`);
if(process.env.STAGES)source=source.replace('Mu = array','"prefix" print\nMu = array').replace("Quot' =",'"sieve" print\nQuot\' =');
if(process.env.STAGES && variant!=='original')source=source.replace('Prefix =','"sieve" print\nPrefix =').replace('Root =','"prefix" print\nRoot =').replace('Answer =','"prepared" print\nAnswer =');
if(process.env.DUMP_SOURCE){process.stdout.write(source);process.exit(0)}
let previous=performance.now();const stages=[];
const r=new Interpreter(v=>{const now=performance.now();stages.push({label:String(v),ms:now-previous});previous=now;},{compilation:mode==='compiled'});
const d=new RuntimeDiagnostics();const t=performance.now();previous=t;
try{if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);const answer=String(r.variables.get('Answer'));const expected={'10':'8','100':'6033','10000000':'5777137137739632912'}[limit];if(expected)assert.equal(answer,expected);console.log(JSON.stringify({mode,variant,limit,answer,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,stages,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{r.dispose()}
