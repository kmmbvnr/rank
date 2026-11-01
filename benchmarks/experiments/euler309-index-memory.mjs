// Research runtime copies only. The removed call guard is unsafe for arbitrary
// callees; these benchmarks use only the scalar native gcd in the Euler source.
import assert from 'node:assert/strict';
import {copyEuler309Baseline} from './euler309-baseline.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function prepareMemoryRuntimes(){
 const dir=mkdtempSync(join(tmpdir(),'rank309-memory-'));
 symlinkSync(new URL('../../node_modules',import.meta.url),join(dir,'node_modules'));
 const paths={};
 for(const name of ['overlay','clear','drain','undo','fresh','flatkeys','fresh-flatkeys','key-only','current']){
  const out=join(dir,name);paths[name]=out;
  copyEuler309Baseline(out);
  const runtimeFile=join(out,'jit/number-loop-runtime.js');let runtime=readFileSync(runtimeFile,'utf8');
  const guard='|| plan.containers.size > 0 && plan.calls.length > 0';assert(runtime.includes(guard));
  if(name!=='key-only' && name!=='current')runtime=runtime.replace(guard,'');
  const file=join(out,'jit/number-loop-index.js');let source=readFileSync(file,'utf8');
  if(name==='clear')source=source.replace('const diagnostics = currentDiagnostics();\n        if (diagnostics)\n            diagnostics.indexWrites','this.changes.clear();\n        const diagnostics = currentDiagnostics();\n        if (diagnostics)\n            diagnostics.indexWrites');
  if(name==='drain')source=source.replace('for (const [key, value] of this.changes)\n            this.source.entries.set(key, BigInt(value));','for (const [key, value] of this.changes) {\n            this.source.entries.set(key, BigInt(value));\n            this.changes.delete(key);\n        }');
  if(['undo','fresh','fresh-flatkeys'].includes(name)){
   source=source.slice(0,source.indexOf('export class PrivateIntegerIndex'))+`export class PrivateIntegerIndex {
    previous = new Map();
    inserted = [];
    writes = 0;
    constructor(source, overflow) {
        this.source = source; this.overflow = overflow;
        this.startedEmpty = ${name!=='undo'} && source.entries.size === 0;
    }
    has(key) { return this.source.entries.has(key); }
    value(key, missing) {
        const value = this.source.entries.get(key), d = currentDiagnostics();
        if (d) { d.indexReads++; if (value === undefined) d.indexReadMisses++; else d.indexReadHits++; }
        if (value === undefined) throw new MissingValueError(missing);
        return value;
    }
    readWide(key, missing = 'missing keyed value') { return BigInt(this.value(key, missing)); }
    read(key, missing = 'missing keyed value') {
        const n = Number(this.value(key, missing));
        if (!Number.isSafeInteger(n)) throw this.overflow;
        return n;
    }
    checkMutable() { checkValueMutable(this.source); }
    set(key, value) {
        if (!Number.isSafeInteger(value)) throw this.overflow;
        const old = this.startedEmpty ? undefined : this.source.entries.get(key);
        if (old === undefined) { if (!this.startedEmpty) this.inserted.push(key); }
        else if (!this.previous.has(key)) this.previous.set(key, old);
        this.source.entries.set(key, BigInt(value)); this.writes++;
    }
    rollback() {
        if (this.startedEmpty) Map.prototype.clear.call(this.source.entries);
        for (const [key, value] of this.previous) Map.prototype.set.call(this.source.entries, key, value);
        for (const key of this.inserted) Map.prototype.delete.call(this.source.entries, key);
        this.previous.clear(); this.inserted = [];
    }
    publish() {
        this.previous.clear(); this.inserted = [];
        const d = currentDiagnostics(); if (d) d.indexWrites += this.writes;
    }
}
`;
   assert(runtime.includes('if (!result) {'));runtime=runtime.replace('if (!result) {','if (!result) {\n                for (const index of indices.values()) index.rollback();');
  }
  if(['flatkeys','fresh-flatkeys','key-only'].includes(name)){
   const keyFile=join(out,'runtime/index-key.js');let key=readFileSync(keyFile,'utf8');
   const old="return `integers:${values.map(value => typeof value === 'bigint' ? value : BigInt(value)).join(',')}`;";
   assert(key.includes(old));key=key.replace(old,"return ['integers:', values.map(value => typeof value === 'bigint' || Number.isSafeInteger(value) ? value : BigInt(value)).join(',')].join('');");
   writeFileSync(keyFile,key);
  }
  writeFileSync(file,source);writeFileSync(runtimeFile,runtime);
 }
 return paths;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [series='final',rounds='3']=process.argv.slice(2),paths=prepareMemoryRuntimes();
 const cases={initial:['overlay','clear','drain','undo'],fresh:['overlay','undo','fresh'],keys:['fresh','flatkeys','fresh-flatkeys'],final:['overlay','fresh-flatkeys','current','key-only']}[series];assert(cases);assert(/^[1-9]\d*$/.test(rounds));
 const rows=[];
 for(let sample=0;sample<Number(rounds);sample++)for(const name of [...cases.slice(sample%cases.length),...cases.slice(0,sample%cases.length)]){
  const env={...process.env,RANK_BENCH_RUNTIME:join(paths[name],'index.js')};
  const r=spawnSync(process.execPath,[new URL('../euler309-investigation.mjs',import.meta.url).pathname,'compiled','1000000','original'],{encoding:'utf8',timeout:45000,env});assert.equal(r.status,0,r.stderr||String(r.error));
  const row={sample,memoryVariant:name,...JSON.parse(r.stdout)};assert.equal(row.answer,'210139');rows.push(row);
  writeFileSync(new URL(`../baselines/2026-11-01-euler309-memory-${series}.json`,import.meta.url),JSON.stringify(rows,null,2)+'\n');
  console.log(JSON.stringify({sample,name,ms:row.ms,cpuMs:row.cpuMs,rssMiB:row.rssMiB,numberLoops:row.diagnostics.numberLoops}));
 }
}
