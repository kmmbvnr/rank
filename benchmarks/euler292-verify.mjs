import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
const [variant='radius',mode='compiled']=process.argv.slice(2);
const cases=JSON.parse(readFileSync(0,'utf8'));
const source=readFileSync(new URL(variant==='shipping'?'../demos/euler/292_pythagoreanpolygons.ra':`./experiments/euler292-${variant}.ra`,import.meta.url),'utf8');
for(const [n,expected] of cases){const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'});try{runtime.execute(source.replace('arg N integer = 120',`arg N integer = ${n}`));assert.equal(String(runtime.variables.get('Answer')),String(expected),`${variant}/${mode}/N=${n}`);}finally{runtime.dispose();}}
console.log(JSON.stringify({variant,mode,comparisons:cases.length}));
