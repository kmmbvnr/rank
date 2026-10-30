import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',limit='10']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(limit));
assert(['original','safe','capped','pruned','hoisted','congruent','reduced','shipping'].includes(variant));
let source=readFileSync(new URL(variant==='shipping'?'../demos/euler/283_integertriangles.ra':`./experiments/euler283-${variant}.ra`,import.meta.url),'utf8');
source=source.replace('arg Top integer = 1000',`arg Top integer = ${limit}`);
if(process.env.STAGES)source=source.replace('Pl = array','"sieve" print\nPl = array');
let previous=performance.now();const stages=[];
const r=new Interpreter(v=>{const now=performance.now();stages.push({label:String(v),ms:now-previous});previous=now;},{compilation:mode==='compiled'}),d=new RuntimeDiagnostics();
const t=performance.now();previous=t;
try{if(process.env.DIAGNOSTICS)d.run(()=>r.execute(source));else r.execute(source);const answer=String(r.variables.get('Answer'));const expected={'1':'192','2':'2796','5':'140098','10':'3781786','1000':'28038042525570324'}[limit];if(expected)assert.equal(answer,expected);console.log(JSON.stringify({mode,variant,limit,answer,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,stages,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{r.dispose()}
