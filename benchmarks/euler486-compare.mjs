import { spawnSync } from 'node:child_process';
import { loadavg, freemem } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [rounds='3']=process.argv.slice(2), runs=[];
const variants=[{name:'original',file:'benchmarks/fixtures/euler486-original.ra'}, {name:'final',file:'demos/euler/486_palindromestrings.ra'}];
for(const mode of ['compiled','reference']) for(let round=0;round<Number(rounds);round++) {
    for(const item of round%2 ? variants.toReversed() : variants) {
        const started=new Date().toISOString(), load=loadavg(), freeMiB=freemem()/1048576;
        const result=spawnSync(process.execPath,['benchmarks/euler486.mjs',mode,'1000000000000000000',item.file],{encoding:'utf8',maxBuffer:8*1024*1024});
        if(result.status!==0) throw Error(result.stderr||String(result.error));
        const value=JSON.parse(result.stdout);if(value.answer!=='11408450515') throw Error('Wrong answer');
        runs.push({variant:item.name,round,started,load,freeMiB,...value});
        process.stderr.write(`${mode} ${round} ${item.name}: ${value.ms.toFixed(1)} ms ${value.rssMiB.toFixed(1)} MiB\n`);
    }
}
const files=['jit/integer-array-kernel.js','jit/tensor-map.js','runtime/owned-array.js','runtime/sorted-search.js','modules/numbers.js'];
const hash=createHash('sha256');for(const file of files) hash.update(file).update(readFileSync(new URL('../packages/interpreter/out/'+file,import.meta.url)));
console.log(JSON.stringify({node:process.version,arch:process.arch,runtimeFiles:files,runtimeSha256:hash.digest('hex'),runs},null,2));
