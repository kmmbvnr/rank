import {execFileSync} from 'node:child_process';
const [runtime,prototype]=process.argv.slice(2);
const cases=[['original','compiled',runtime],['original','compiled',prototype],['scans-grouped','compiled',runtime],['scans-grouped','reference',runtime],['array','compiled',runtime],['array','reference',runtime]];
for(let pass=0;pass<3;pass++)for(const[variant,mode,rt]of cases){
 const result=JSON.parse(execFileSync(process.execPath,[new URL('../euler364-investigation.mjs',import.meta.url).pathname,variant,'1000000',mode],{env:{...process.env,RUNTIME:rt,DIAG:'',PHASES:'',PROFILE:'',KERNELS:''},encoding:'utf8'}));
 console.log(JSON.stringify({pass,runtime:rt,...result}));
}
