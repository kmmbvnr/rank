import {execFileSync} from 'node:child_process';
// Serial, fresh-process runs; do not overlap with the focused test suites.
for(let pass=0;pass<3;pass++)for(const[problem,arg,mode]of [[362,'10000000000','compiled'],[364,'1000000','compiled'],[364,'1000000','reference']]){
 const result=JSON.parse(execFileSync(process.execPath,[new URL(`./euler${problem}-investigation.mjs`,import.meta.url).pathname,'production',arg,mode],{env:{...process.env,DIAG:'',PROFILE:'',PHASES:'',KERNELS:''},encoding:'utf8'}));
 console.log(JSON.stringify({pass,problem,...result}));
}
