// Final-code confirmation after the pooled-operand lifetime repair.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
const [output]=process.argv.slice(2);if(!output)throw Error('output.json');
const rows=[];
for(let round=0;round<3;round++){
 const p=spawnSync(process.execPath,['benchmarks/euler310-investigation.mjs','compiled','100000','production','split'],{encoding:'utf8',timeout:60000,maxBuffer:2e6});
 if(p.status!==0)throw Error(p.stderr);
 rows.push({round,runtime:'after',...JSON.parse(p.stdout)});
}
writeFileSync(output,JSON.stringify({node:process.version,arch:process.arch,cpu:os.cpus()[0].model,load:os.loadavg(),rows},null,2)+'\n');
