import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(process.argv[2]==='child'){
 const name=process.argv[3],runtime=process.argv[4],{Interpreter}=await import(pathToFileURL(runtime));
 const source=name==='record'?`fun R lookup N\n return ((R .values) N) + R .offset\nend\nR = record\n .values = 0 till 128 array\n .offset = 7\nend\nAnswer = 0\nfor I in 0 till 10000\n Answer += R lookup (I mod 128)\nend` :readFileSync(`demos/euler/${name}.ra`,'utf8');
 const r=new Interpreter(()=>{}),cpu=process.cpuUsage(),t=performance.now();try{r.execute(source);const answer=String((r.variables.get('Answer') ?? r.lastResult)),want={record:'704104','303_smalldigits':'1111981904675169','304_primonacci':'283988410192'}[name];if(answer!==want)throw Error(`${name}: ${answer} != ${want}`);const usage=process.cpuUsage(cpu);console.log(JSON.stringify({ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer}));}finally{r.dispose();}
}else{
 const rows=[];for(let round=0;round<3;round++)for(const name of ['record','303_smalldigits','304_primonacci'])for(const phase of round%2?['after','before']:['before','after']){
 const runtime=phase==='before'?'/tmp/rank305-before/out/index.js':'/tmp/rank305-after/out/index.js';
 const p=spawnSync(process.execPath,[process.argv[1],'child',name,runtime],{encoding:'utf8',timeout:60000});if(p.status!==0)throw Error(p.stderr||String(p.error));rows.push({round,name,phase,...JSON.parse(p.stdout)});writeFileSync('benchmarks/baselines/2026-11-01-euler305-controls.json',JSON.stringify({records:rows},null,2)+'\n');
 }
}
