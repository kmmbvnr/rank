// Copy into the isolated payload root containing source-manifest.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import os from 'node:os';
const root=fileURLToPath(new URL('.',import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(root,'source-manifest.json'),'utf8'));
for(const [path,hash]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex'),hash,path);
const host=()=>({node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,threads:os.cpus().length,load:os.loadavg()});
const phase=process.argv[2];assert(['fft','controls','integration'].includes(phase));
writeFileSync(resolve(root,`host-${phase}-before.json`),JSON.stringify(host(),null,2));
const env={...process.env,RANK_BENCH_COMMIT:manifest.versions.candidate,RANK_BENCH_BASELINE_COMMIT:manifest.versions.baseline,RANK_BENCH_REVISIONS:JSON.stringify(manifest.versions)};
const args=phase!=='controls'?['benchmarks/fft.mjs',`--baseline=${root}baseline`,'--samples=5',phase==='integration'?'--sizes=4096':'--sizes=4096,16384','--warmup-ms=1500','--batch-ms=750','--batches=3',phase==='integration'?'--modes=baseline,compiled,js-direct':'--modes=baseline,compiled,js-inplace,js-direct',`--output=${root}fft.json`]
:['benchmarks/integer-vector-loops.mjs',`--baseline=${root}baseline`,'--samples=5','--warmup-ms=1500','--batch-ms=500','--batches=3',`--output=${root}controls.json`];
execFileSync(process.execPath,args,{cwd:resolve(root,'candidate'),env,stdio:'inherit'});
writeFileSync(resolve(root,`host-${phase}-after.json`),JSON.stringify(host(),null,2));
