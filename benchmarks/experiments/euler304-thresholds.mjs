import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
if(process.argv[2]==='child'){
 const {primeRange}=await import(pathToFileURL(process.argv[3]));let n=0,last;const t=performance.now(),cpu=process.cpuUsage();
 for(const p of primeRange(10n**14n,true,undefined,false)){last=p;if(++n===Number(process.argv[4]))break;}
 const usage=process.cpuUsage(cpu);console.log(JSON.stringify({ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,last:String(last)}));
}else{
 const source=readFileSync('packages/interpreter/out/runtime/prime-sequence.js','utf8'),files=[];
 const variants=[['before','/tmp/rank304-before/out/runtime/prime-sequence.js']];
 for(const threshold of [256,1024,4096,8192]){
  const path=`${process.cwd()}/packages/interpreter/out/runtime/euler304-threshold-${threshold}.js`;files.push(path);
  writeFileSync(path,source.replace(/const primeRunSieveDemand = \d+;/,`const primeRunSieveDemand = ${threshold};`));variants.push([threshold,path]);
 }
 const records=[];
 try{for(let round=0;round<3;round++)for(const count of [1,256,1000,10000,100000])for(const [threshold,path] of variants){
  const p=spawnSync(process.execPath,[process.argv[1],'child',path,String(count)],{encoding:'utf8',timeout:30000});if(p.status!==0)throw Error(p.stderr);
  records.push({round,count,threshold,...JSON.parse(p.stdout)});
  writeFileSync('benchmarks/baselines/2026-11-01-euler304-thresholds.json',JSON.stringify({records},null,2)+'\n');
 }}finally{files.forEach(file=>unlinkSync(file));}
}
