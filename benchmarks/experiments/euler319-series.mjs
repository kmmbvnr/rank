import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler319-investigation.mjs',import.meta.url));
const cases=[
 ['compiled','10000000000','4641589','original'],
 ['compiled','10000000000','4641589','scan'],
 ['compiled','10000000000','4641589','whole'],
 ['compiled','10000000000','4641589','prefix'],
 ['compiled','10000000000','2000000','whole'],
 ['compiled','10000000000','8000000','whole'],
 ['reference','1000000','10000','original'],
 ['reference','1000000','10000','scan'],
 ['reference','1000000','10000','whole'],
];
const records=[];
for(let trial=0;trial<3;trial++) for(let j=0;j<cases.length;j++){
 const args=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:45000});
 const record={trial,args,status:p.status,...(p.status===0?JSON.parse(p.stdout):{error:p.error?.message,stderr:p.stderr})};
 if(p.status===0 && record.answer!==({'10000000000':'268457129','1000000':'585561545'}[args[1]]))throw Error('incorrect answer');
 records.push(record);process.stderr.write(`${JSON.stringify(record)}\n`);
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
