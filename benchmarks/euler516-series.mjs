import {spawnSync} from 'node:child_process';
const variants=process.argv.slice(2);if(!variants.length)variants.push('original','blocked','direct','blocked-direct');
for(let sample=0;sample<3;sample++)for(const mode of ['compiled','reference'])for(const variant of sample%2?[...variants].reverse():variants){
 const r=spawnSync(process.execPath,['benchmarks/euler516-investigation.mjs','1000000000000',mode,variant],{encoding:'utf8',timeout:30000,env:{...process.env,PROFILE:'',DIAGNOSTICS:'',CONTROL:''}});
 if(r.error||r.status!==0)throw Error(r.stderr||String(r.error));
 console.log(JSON.stringify({sample,...JSON.parse(r.stdout)}));
}
