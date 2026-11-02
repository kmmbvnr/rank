import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {render, distribution} from './report.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t, cli) {
 const dir = mkdtempSync(resolve(tmpdir(), 'rank-nightly-'));
 t.after(() => rmSync(dir, {recursive:true, force:true}));
 mkdirSync(resolve(dir,'packages/interpreter'),{recursive:true});
 symlinkSync(resolve(root,'packages/interpreter/out'),resolve(dir,'packages/interpreter/out'));
 mkdirSync(resolve(dir,'packages/cli/out'),{recursive:true});
 writeFileSync(resolve(dir,'packages/cli/package.json'),'{"type":"module"}');
 writeFileSync(resolve(dir,'packages/cli/out/main.js'),'export default async function main(){'+cli+'}');
 mkdirSync(resolve(dir,'demos/example'),{recursive:true});
 writeFileSync(resolve(dir,'demos/example/a.ra'),'1\n');
 writeFileSync(resolve(dir,'demos/example/b.ra'),'fun X double = X * 2\n');
 writeFileSync(resolve(dir,'demos/example/b_test.ra'),'test "double"\n 1 double equal 2\nend\n');
 execFileSync('git',['init','-q',dir]);
 execFileSync('git',['-C',dir,'add','.']);
 execFileSync('git',['-C',dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','fixture']);
 return dir;
}
function run(dir, timeout) {
 execFileSync(process.execPath,[resolve(root,'benchmarks/nightly/run.mjs'),'--checkout='+dir,'--output='+resolve(dir,'report'),'--timeout='+timeout],{timeout:20000});
 return JSON.parse(readFileSync(resolve(dir,'report/latest.json')));
}
test('continues after failure, selects library tests and preserves history',t=>{
 const dir=fixture(t,'process.exitCode=process.argv[2]==="test"?0:1');
 const a=run(dir,3000);
 assert.equal(a.status,'complete');
 assert.deepEqual(a.results.map(x=>x.status),['error','ok']);
 assert.deepEqual(a.results.map(x=>x.kind),['program','tests']);
 run(dir,3000);
 assert.equal(JSON.parse(readFileSync(resolve(dir,'report/history.json'))).length,2);
 assert.match(readFileSync(resolve(dir,'report/runs',a.id+'.html'),'utf8'),/<base href="\.\.\/">/);
 execFileSync(process.execPath,[resolve(root,'benchmarks/nightly/render-latest.mjs'),resolve(dir,'report')]);
 assert.match(readFileSync(resolve(dir,'report/dashboard.html'),'utf8'),/Execution time distribution/);
});
test('kills stuck workloads and continues',t=>{
 const dir=fixture(t,'setInterval(()=>{},1000)');
 const a=run(dir,100);
 assert.deepEqual(a.results.map(x=>x.status),['timeout','timeout']);
 assert.equal(a.status,'complete');
});
test('escapes executable markup in report data',()=>{
 const html=render({host:'<img>',cpu:'cpu',node:'24',commit:'abc',subject:'</script><script>bad()',started:'now',status:'complete',updated:'now',timeoutMs:600000,results:[]});
 assert(!html.includes('<script>bad()'));
 assert(html.includes('&lt;img&gt;'));
});

test('distribution includes failures in their time buckets but excludes them from percentiles',()=>{
 const data=distribution([
  ...[0,99,100,299,300,999,1000,600000].map(ms=>({status:'ok',ms})),
  {status:'timeout',ms:600000}, {status:'error',ms:200},
  {status:'ok',ms:null}, {status:'ok',ms:-1},
 ]);
 assert.deepEqual(data.counts,[2,2,2,1,0,0,0,0,0,1]);
 assert.equal(data.count,8);
 assert.deepEqual(data.errorCounts,[0,1,0,0,0,0,0,0,0,0]);
 assert.equal(data.counts.reduce((a,b)=>a+b,0)+data.errorCounts.reduce((a,b)=>a+b,0)+data.timeoutCounts.reduce((a,b)=>a+b,0),10);
 assert.deepEqual(data.timeoutCounts,[0,0,0,0,0,0,0,0,0,1]);
 assert.equal(distribution([{status:'timeout',ms:1000}]).timeoutCounts[3],1);
 assert.equal(data.median,299.5);
 assert.equal(data.p90,600000);
 assert.equal(distribution([]).median,null);
});

test('uses companion fixtures for required arguments and stdin programs',t=>{
 const dir=fixture(t,'process.exitCode=0');
 writeFileSync(resolve(dir,'demos/example/c.ra'),'use cli\narg Input path\nInput\n');
 writeFileSync(resolve(dir,'demos/example/c_test.ra'),'use testing\n');
 writeFileSync(resolve(dir,'demos/example/d.ra'),'use io\nstdin .integer\n');
 writeFileSync(resolve(dir,'demos/example/d_test.ra'),'use testing\n');
 writeFileSync(resolve(dir,'demos/example/e.ra'),'use cli\narg Input path\nInput\n');
 const a=run(dir,3000);
 assert.deepEqual(a.results.map(x=>x.kind),['program','tests','tests','tests','tests']);
 assert.equal(a.results[2].status,'ok');
 assert.match(a.results[2].workloadReason,/Required arguments/);
 assert.equal(a.results[3].status,'ok');
 assert.match(a.results[3].workloadReason,/Stdin workload/);
 assert.equal(a.results[4].status,'no-workload');
});
