import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(process.argv[2]==='child'){
 const [,, ,file,runtime]=process.argv;const {Interpreter}=await import(pathToFileURL(runtime));
 const r=new Interpreter(()=>{}),t=performance.now(),cpu=process.cpuUsage();
 try{r.execute(readFileSync(`demos/euler/${file}.ra`,'utf8'));const answer=String((r.variables.get('Answer') ?? r.lastResult)),want={'060_primepairs':'26033','263_engineersdream':'2039506520'}[file];if(answer!==want)throw Error(answer);const usage=process.cpuUsage(cpu);console.log(JSON.stringify({ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer}));}finally{r.dispose();}
}else{
 const rows=[];for(let round=0;round<3;round++)for(const file of ['060_primepairs','263_engineersdream'])for(const phase of round%2?['after','before']:['before','after']){
  const runtime=phase==='before'?'/tmp/rank304-before/out/index.js':`${process.cwd()}/packages/interpreter/out/index.js`;
  const p=spawnSync(process.execPath,[process.argv[1],'child',file,runtime],{encoding:'utf8',timeout:60000});if(p.status!==0)throw Error(p.stderr||String(p.error));rows.push({round,file,phase,...JSON.parse(p.stdout)});
  writeFileSync('benchmarks/baselines/2026-11-01-euler304-controls.json',JSON.stringify({records:rows},null,2)+'\n');
 }
}
