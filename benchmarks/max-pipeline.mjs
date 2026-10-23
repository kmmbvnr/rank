import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {cpus} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
const size=10000000;
if(process.argv[2]==='worker'){
 const [root,syntax]=process.argv.slice(3);
 const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(root+'/packages/interpreter/out/index.js'));
 const runtime=new Interpreter();
 const sources={
  scalar:`fun N scalar\n Best = 0\n for I in 0 till N\n  Best = ${syntax==='new'?'Best max I':'Best I max'}\n end\n return Best\nend`,
  addressed:`fun A addressed N
 Best = 0
 for I in 0 till N
  Best = ${syntax==='new'?'A (I mod 4) max Best':'A (I mod 4) Best max'}\n end\n return Best\nend`,
 };
 runtime.execute('A = array 3 9 2 7\n'+Object.values(sources).join('\n'));
 const result={sources,node:process.version,size,times:{},compiledLoops:{}};
 for(const name of ['scalar','addressed']){
  const fn=runtime.variables.get(name),args=n=>name==='scalar'?[BigInt(n)]:[runtime.variables.get('A'),BigInt(n)];
  for(let i=0;i<3;i++)fn.call(args(100000));
  const diagnostics=new RuntimeDiagnostics(),start=performance.now();
  const value=diagnostics.run(()=>fn.call(args(size)));
  result.times[name]=performance.now()-start;result.compiledLoops[name]=diagnostics.compiledLoops;
  assert.equal(value,name==='scalar'?BigInt(size-1):9n);
 }
 runtime.dispose();console.log(JSON.stringify(result));
}else{
 // The baseline uses the former postfix spelling; the candidate uses A max B.
 const baseline=process.argv[2];
 assert(baseline, 'Usage: node benchmarks/max-pipeline.mjs /path/to/built/baseline');
 const roots={baseline:resolve(baseline),candidate:resolve(import.meta.dirname,'..')};
 const report={samples:5,size,node:process.version,cpu:cpus()[0]?.model,
  revisions:Object.fromEntries(Object.entries(roots).map(([name,root])=>[name,execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()])),
  dirty:Object.fromEntries(Object.entries(roots).map(([name,root])=>[name,Boolean(execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim())])),
  results:{baseline:[],candidate:[]}};
 for(let i=0;i<5;i++)for(const name of i%2?['candidate','baseline']:['baseline','candidate']){
  const child=spawnSync(process.execPath,[import.meta.filename,'worker',roots[name],name==='baseline'?'old':'new'],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);report.results[name].push(JSON.parse(child.stdout));
 }
 const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
 report.medians=Object.fromEntries(Object.entries(report.results).map(([name,runs])=>[name,Object.fromEntries(['scalar','addressed'].map(key=>[key,median(runs.map(r=>r.times[key]))]))]));
 console.log(JSON.stringify(report,null,2));
}
