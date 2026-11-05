import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadavg} from 'node:os';
import {createHash} from 'node:crypto';
const revisions=['7749fbf9','e3358470','40adaba7'];
const base='/tmp/rank275-comparison';
if(process.argv[2]==='child'){
 const [, , , revision,n='18',diagnostic='false']=process.argv;assert(revisions.includes(revision));assert(['15','18'].includes(n));
 const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(`${base}/${revision}/packages/interpreter/out/index.js`).href);
 const compiled=[];
 const calibrate=()=>{const t=performance.now();let sum=0;for(let i=0;i<500000000;i++)sum=(sum+i)|0;assert(Number.isInteger(sum));return performance.now()-t;};
 const calibrationBefore=process.env.CALIBRATION?calibrate():undefined;
 const runtime=new Interpreter(()=>{}, {compilation:true,...(diagnostic==='true'?{onIntegerLoopCompiled:s=>compiled.push({sha256:createHash('sha256').update(s).digest('hex'),chars:s.length})}:{})});
 const source=readFileSync('demos/euler/275_balancedsculptures.ra','utf8').replace('arg N integer = 18',`arg N integer = ${n}`);
 const diagnostics=new RuntimeDiagnostics(),cpu=process.cpuUsage(),t=performance.now();
 try{if(diagnostic==='true')diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 const ms=performance.now()-t,cpuMs=Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000,calibrationAfter=process.env.CALIBRATION?calibrate():undefined,answer=String(runtime.variables.get('Answer'));assert.equal(answer,n==='18'?'15030564':'360505');
 console.log(JSON.stringify({revision,n:+n,answer,ms,cpuMs,calibrationBefore,calibrationAfter,load:loadavg(),rssMiB:process.resourceUsage().maxRSS/1024,...(diagnostic==='true'?{compiled,diagnostics}:{})}));}finally{runtime.dispose();}
}else{
 const followup=process.argv[2]==='followup';
 const samples=[];
 function run(rev,n,diagnostic=false){const p=spawnSync(process.execPath,[process.argv[1],'child',rev,String(n),String(diagnostic)],{encoding:'utf8',timeout:150000});assert.equal(p.status,0,p.stderr||p.error?.message);const row=JSON.parse(p.stdout);samples.push(row);console.log(JSON.stringify(row));writeFileSync(`benchmarks/baselines/2026-10-31-euler275-${followup?'followup':'regression'}.json`,JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,samples},null,2)+'\n');}
 if(followup){for(let repeat=0;repeat<3;repeat++)for(const rev of (repeat%2?['40adaba7','e3358470']:['e3358470','40adaba7']))run(rev,18);}
 else {for(const rev of revisions)run(rev,15,true);for(let repeat=0;repeat<3;repeat++)for(let i=0;i<3;i++)run(revisions[(repeat+i)%3],18);}
}
