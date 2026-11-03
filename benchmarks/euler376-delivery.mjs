import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
assert.ok(process.env.BASELINE_RUNTIME, 'BASELINE_RUNTIME must name the prior built interpreter');
const current=process.env.RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).pathname;
const variants=[['original','benchmarks/experiments/euler376-original.ra','973059630185670'],['production','demos/euler/376_dice.ra','973059630185670'],['shift','benchmarks/experiments/euler376-shift-kernel.ra','2097151000000'],['369','demos/euler/369_badugi.ra','862400558448'],['375','demos/euler/375_subseqmin.ra','7435327983715286168']];
let jobs=[];
for(const[label,file,answer]of variants)for(const[policy,runtime]of[['before',process.env.BASELINE_RUNTIME],['after',current]])jobs.push({label:`${label}-${policy}`,file,answer,runtime});
if(process.env.CASES)jobs=jobs.filter(j=>process.env.CASES.split(',').includes(j.label));
const trials=Number(process.env.TRIALS||3),samples=[];
for(let trial=0;trial<trials;trial++)for(const j of trial%2?[...jobs].reverse():jobs){const p=spawnSync(process.execPath,['benchmarks/euler376-investigation.mjs',j.file],{encoding:'utf8',env:{...process.env,RUNTIME:j.runtime,DIAG:'',PHASES:'',PROFILE:''}});assert.equal(p.status,0,p.stderr);const sample={trial,label:j.label,...JSON.parse(p.stdout)};assert.equal(sample.answer,j.answer);samples.push(sample);console.log(JSON.stringify(sample));}
if(process.env.OUTPUT)writeFileSync(process.env.OUTPUT,JSON.stringify({node:process.version,cpu:os.cpus()[0].model,arch:process.arch,trials,baseline:process.env.BASELINE_RUNTIME,current,samples},null,2)+'\n');
