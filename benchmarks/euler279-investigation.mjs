import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',limit='1000000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(limit));
let source=readFileSync(new URL(variant==='shipping'?'../demos/euler/279_integralangle.ra':`./experiments/euler279-${variant==='deferred'?'original':variant}.ra`,import.meta.url),'utf8');
source=source.replace('arg Limit integer = 100000000',`arg Limit integer = ${limit}`);
if(variant==='deferred')for(const name of ['Ns','Ms','Co','Odd','Ok','Pk','Qk','Div','Q','By3','P'])source=source.replace(new RegExp(`^( +)${name} =`,'gm'),`$1${name}' =`);
if(process.env.STAGES)source=source.replace('for N in 1 to Top','"right and obtuse" print\nfor N in 1 to Top').replace('Answer =','"acute" print\nAnswer =');
if(process.env.DUMP_SOURCE){process.stdout.write(source);process.exit(0)}
let previous=performance.now();const stages=[];
const r=new Interpreter(v=>{const now=performance.now();stages.push({label:String(v),ms:now-previous});previous=now;},{compilation:mode==='compiled'}),d=new RuntimeDiagnostics();
const t=performance.now();previous=t;
try{if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);const answer=String(r.variables.get('Answer'));const expected={'100':'84','200':'203','5000':'8891','100000000':'416577688'}[limit];if(expected)assert.equal(answer,expected);console.log(JSON.stringify({mode,variant,limit,answer,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,stages,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{r.dispose()}
