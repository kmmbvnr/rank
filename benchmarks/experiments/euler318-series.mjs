import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=process.env.RANK_ROOT||process.cwd(), rows=[];
for(let i=0;i<5;i++) {
 const cases=process.env.RANK318_DELIVERY ? [['reference','original'],['reference','production'],['compiled','original'],['compiled','production'],['exact','production']] : [['reference','original'],['reference','bounded'],['reference','break'],['compiled','original'],['compiled','bounded'],['compiled','break'],['compiled','stable'],['exact','original']];
 for(const [mode,variant] of [...cases.slice(i%cases.length),...cases.slice(0,i%cases.length)]) {
 const x=spawnSync(process.execPath,[fileURLToPath(new URL('../euler318-investigation.mjs', import.meta.url)),mode,'2011',variant],{env:{...process.env,RANK_ROOT:root},encoding:'utf8'});
 if(x.status!==0)throw Error(x.stderr);const row=JSON.parse(x.stdout);if(row.answer!=='709313889')throw Error(x.stdout);rows.push(row);
 }
}
console.log(JSON.stringify({node:process.version,host:process.env.RANK318_HOST,rows},null,2));
