import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
// @ts-expect-error The independent native oracle is a benchmark module.
import { edgeExpectation, exhaustiveExpectation } from '../../../benchmarks/euler514-oracle.mjs';
import { answerOf } from './support.js';

const source=readFileSync(new URL('../../../demos/euler/514_geoboard.ra',import.meta.url),'utf8');
const old=readFileSync(new URL('../../../benchmarks/experiments/euler514-original.ra',import.meta.url),'utf8');
const rounded=(n:number)=>Math.round(n*100000)/100000;
for(const compilation of [false,true]) {
    it(`matches independent geometry and the old algorithm (${compilation})`,()=>{
        for(let n=0;n<=12;n++) {
            const expected=rounded(edgeExpectation(n));
            if(n<=3)expect(rounded(exhaustiveExpectation(n)),`subset N=${n}`).toBe(expected);
            for(const program of [source,old]) {
                const runtime=new Interpreter(()=>{}, {compilation,args:[`--n=${n}`]});
                try {
                    runtime.execute(program);
                    expect(Number(answerOf(runtime)),`N=${n}`).toBe(expected);
                } finally {runtime.dispose();}
            }
        }
    },30_000);
}

it('retains the full default answer',()=>{
    // A synchronous regression must have a process-level deadline.
    const run=spawnSync(process.execPath,
        ['benchmarks/euler514-investigation.mjs','100','compiled','lines'],
        {cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8',timeout:15_000,
            env:{...process.env,PROFILE:'',DIAGNOSTICS:''}});
    expect(run.error,run.stderr).toBeUndefined();
    expect(run.status,run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).answer).toBe('8986.86698');
},20_000);
