import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [limit='10000000',rounds='3',output='/tmp/rank378-series.json']=process.argv.slice(2);
const rows=[];
const cases=[['original','benchmarks/euler378-investigation.mjs','benchmarks/experiments/euler378-original.ra'],
 ['one-tree','benchmarks/euler378-investigation.mjs','benchmarks/experiments/euler378-one-tree.ra'],
 ['number-one-tree','benchmarks/experiments/euler378-number-fenwick.mjs','benchmarks/experiments/euler378-one-tree.ra']];
for(let round=0;round<Number(rounds);round++)for(const[variant,script,source]of cases){
 const row=JSON.parse(execFileSync(process.execPath,[script,source,limit,'compiled'],{encoding:'utf8',env:{...process.env,STAGES:'1',MEMORY:'1'}}));
 rows.push({round,variant,...row});writeFileSync(output,JSON.stringify(rows,null,2)+'\n');
}
console.log(JSON.stringify(rows));
