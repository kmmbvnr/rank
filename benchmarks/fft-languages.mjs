// Same-machine FFT comparison. Build Rank before running.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const root=fileURLToPath(new URL('..',import.meta.url));
const { values } = parseArgs({ options: {
  python: { type: 'string', default: 'python3' },
  ruby: { type: 'string', default: 'ruby' },
  size: { type: 'string', default: '4096' },
  samples: { type: 'string', default: '7' },
  output: { type: 'string' },
} });
const python = values.python, ruby = values.ruby;
const modes=['rank','js','python','ruby','ruby-yjit','numpy-public','numpy-native'];
const n = Number(values.size), samples = Number(values.samples), rows = [];
assert(Number.isSafeInteger(n) && n >= 128 && n <= 0x40000000 && (n & (n - 1)) === 0);
assert(Number.isSafeInteger(samples) && samples >= 3);
const report={cpu:cpus()[0].model,node:process.version,loadBefore:loadavg(),
 runtimes: { python, ruby, node: process.execPath },
 commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 timing:'Serial fresh processes, rotating mode order; >=1.5 s warmup and three >=750 ms batches. Inputs prepared outside timing. Scalar ports compute roots and output permutation per call. Full output allocated each call. numpy-public includes input-list to ndarray and output to two Python lists; numpy-native receives a prebuilt ndarray and returns a complex ndarray. Native mode is a separate contract. Independent small DFT and full signal spectrum checks outside timing.',
 sources:Object.fromEntries(['benchmarks/fft.mjs','benchmarks/experiments/fft-python.py','benchmarks/experiments/fft-ruby.rb','demos/classic/fft.ra'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]))};
for(let trial=0;trial<samples;trial++){
 const order=modes.map((_,i)=>modes[(i+trial)%modes.length]);
 for(const mode of order){
  let executable,args;
  if(mode==='rank'||mode==='js'){
   executable=process.execPath;args=['benchmarks/fft.mjs',`--worker=${mode==='rank'?'compiled':'js-direct'}`,`--size=${n}`,'--warmup-ms=1500','--batch-ms=750','--batches=3'];
  }else if(mode.startsWith('ruby')){
   executable=ruby;args=[mode==='ruby-yjit'?'--yjit':'--disable-yjit','benchmarks/experiments/fft-ruby.rb',String(n)];
  }else{executable=python;args=['benchmarks/experiments/fft-python.py',mode,String(n)];}
  const child=spawnSync(executable,args,{cwd:root,encoding:'utf8',timeout:90000});
  assert.ifError(child.error);assert.equal(child.status,0,`${mode}: ${child.stderr}`);
  const row=JSON.parse(child.stdout);
  if(mode.startsWith('ruby'))assert.equal(row.yjit,mode==='ruby-yjit');
  rows.push({trial,...row,mode});
  process.stderr.write(`${trial+1}/${samples} ${mode}\n`);
 }
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const summary=modes.map(mode=>{
 const found=rows.filter(row=>row.mode===mode);
 return {mode,ms:median(found.map(row=>row.warmMs)),cpuMs:median(found.map(row=>row.cpuMs)),minMs:Math.min(...found.map(row=>row.warmMs)),maxMs:Math.max(...found.map(row=>row.warmMs))};
});
if (values.output) writeFileSync(resolve(root,values.output),JSON.stringify({...report,date:new Date().toISOString(),n,samples,loadAfter:loadavg(),summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
