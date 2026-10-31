import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',n='60']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));assert(/^\d+$/.test(n)||n==='fixture');assert(/^[a-z]+$/.test(variant));
const source=readFileSync(new URL(variant==='shipping'?'../demos/euler/292_pythagoreanpolygons.ra':`./experiments/euler292-${variant}.ra`,import.meta.url),'utf8').replace('arg N integer = 120',`arg N integer = ${n==='fixture'?120:n}`);
const fixtureUrl=new URL('../demos/euler/292_pythagoreanpolygons_test.ra',import.meta.url);
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled',...(n==='fixture'?{sourceId:fileURLToPath(fixtureUrl),loadModule:specifier=>{assert(/292_pythagoreanpolygons(?:\.ra)?$/.test(specifier));return {id:fileURLToPath(new URL('../demos/euler/292_pythagoreanpolygons.ra',import.meta.url)),source};}}:{})});const start=performance.now();
try{
 const executed=n==='fixture'?readFileSync(variant==='shipping'?fixtureUrl:new URL('./experiments/euler292-fixture.ra',import.meta.url),'utf8'):source;
 const parts=process.env.PHASES?executed.split(/(?=^Total =)/m):[executed];
 for(let i=0;i<parts.length;i++){const diagnostics=new RuntimeDiagnostics();const t=performance.now();if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(parts[i]));else runtime.execute(parts[i]);console.log(JSON.stringify({phase:i,ms:performance.now()-t,...(process.env.DIAGNOSTICS?{diagnostics}:{})}));}
 if(n==='fixture'){assert.equal(runtime.testResults.length,variant==='shipping'?2:1);assert(runtime.testResults.every(t=>t.passed),JSON.stringify(runtime.testResults));}
 const answer=n==='fixture'?'fixture passed':String(runtime.variables.get('Answer'));const expected={4:'1',30:'3655',60:'891045',120:'3600060866'}[n];if(expected)assert.equal(answer,expected);
 console.log(JSON.stringify({mode,variant,n:n==='fixture'?n:+n,ms:performance.now()-start,answer,rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{runtime.dispose();}
