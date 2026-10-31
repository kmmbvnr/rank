import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',n='3138428376721',mod='1000000000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));assert(/^\d+$/.test(n)&&/^\d+$/.test(mod));assert(/^[a-z]+$/.test(variant));
const source=readFileSync(new URL(`./experiments/euler294-${variant}.ra`,import.meta.url),'utf8').replace('arg N integer = 3138428376721',`arg N integer = ${n}`).replace('arg Mod integer = 1000000000',`arg Mod integer = ${mod}`);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'});const start=performance.now();
try{const diagnostics=new RuntimeDiagnostics();if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
const answer=String(runtime.variables.get('Answer'));const exact={9:'263626',42:'6377168878570056','3138428376721':'789184709'}[n];if(exact&&(n!=='3138428376721'||mod==='1000000000'))assert.equal(answer,String(BigInt(exact)%BigInt(mod)));
console.log(JSON.stringify({mode,variant,n,mod,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAGNOSTICS?{diagnostics}:{})}));}finally{runtime.dispose();}
