import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const cases=[
 ['023','demos/euler/023_abundantsums.ra',[]],
 ['283-small','demos/euler/283_integertriangles.ra',['--top=100']],
 ['324-small','demos/euler/324_tower.ra',['--exp=1000000000000']],
 ['337-million','demos/euler/337_totientstairs.ra',['--limit=1000000']],
];
if(process.env.RANK_OWNERSHIP_CASE){
 const entry=cases.find(([name])=>name===process.env.RANK_OWNERSHIP_CASE);
 if(!entry)throw Error('unknown demo');
 const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK414_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
 const source=readFileSync(new URL('../../'+entry[1],import.meta.url),'utf8');
 let outlines=0;
 const runtime=new Interpreter(()=>{},{args:entry[2],onIntegerLoopCompiled:source=>{outlines+=(source.match(/function traversal\d+\(/g)??[]).length;}});
 const diagnostics=new RuntimeDiagnostics(),start=performance.now();
 try{diagnostics.run(()=>runtime.execute(source));console.log(JSON.stringify({name:entry[0],args:entry[2],ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),outlines,diagnostics}));}finally{runtime.dispose();}
}else{
 for(let pair=0;pair<3;pair++)for(const [name] of cases){
  let answer;
  for(const variant of ['baseline','inline']){
   const env={...process.env,RANK_OWNERSHIP_CASE:name};
   if(variant==='baseline')env.RANK414_RUNTIME=process.env.RANK414_FRAME_BASELINE??'/tmp/rank414-frames-baseline/packages/interpreter/out/index.js';else delete env.RANK414_RUNTIME;
   const result=spawnSync(process.execPath,['benchmarks/experiments/ownership-loop-demos.mjs'],{env,encoding:'utf8'});
   if(result.status!==0)throw Error(result.stderr);
   const record=JSON.parse(result.stdout);
   if(variant==='baseline')answer=record.answer;else if(record.answer!==answer)throw Error(`${name}: answer changed`);
   console.log(JSON.stringify({pair,variant,...record}));
  }
 }
}
