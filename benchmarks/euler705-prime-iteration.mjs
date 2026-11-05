import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {pathToFileURL} from 'node:url';
const {densePrimePlan}=await import(pathToFileURL((process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'))+'/packages/interpreter/out/dense-prime-sieve.js'));
const p=densePrimePlan(10000000n);
let count=0,last;
const start=performance.now();
for(const prime of p.iterate()){count++;last=prime}
const ms=performance.now()-start;
assert.equal(count,664579);assert.equal(last,9999991n);
console.log(JSON.stringify({ms,maxRssMiB:process.resourceUsage().maxRSS/1024}));
