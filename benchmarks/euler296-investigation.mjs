import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',n='100000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(['original','pruned','native','combined','vector','sums','prefix','shipping'].includes(variant));
assert(/^\d+$/.test(n));
const file=variant==='shipping'?'../demos/euler/296_angularbisector.ra':`./experiments/euler296-${variant}.ra`;
const source=readFileSync(new URL(file,import.meta.url),'utf8').replace('arg Limit integer = 100000',`arg Limit integer = ${n}`);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'});
const start=performance.now();
try{const diagnostics=new RuntimeDiagnostics();if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
const known={30:'25',100:'376',200:'1762',1000:'61339',10000:'8740638',100000:'1137208419'};
if(known[n]) assert.equal(String(runtime.variables.get('Answer')),known[n]);
console.log(JSON.stringify({mode,variant,n,answer:String(runtime.variables.get('Answer')),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAGNOSTICS?{diagnostics}:{})}));}finally{runtime.dispose();}
