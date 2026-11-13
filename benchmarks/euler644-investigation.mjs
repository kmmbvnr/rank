import {readFileSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
if(process.env.CONTROL==='baseline')await import('./euler644-baseline-runtime.mjs');
else if(process.env.CONTROL)throw Error('unknown control');
const {Interpreter}=await import('../packages/interpreter/out/index.js');
const [lo='200',hi='500',mode='compiled',variant='final']=process.argv.slice(2);
const path=variant==='final'?'../demos/euler/644_squaresontheline.ra':`experiments/euler644-${variant}.ra`;
let source=readFileSync(new URL(path,import.meta.url),'utf8');
if(process.env.PROGRESS)source=source.replace('for W in 1 to Lim','for W in 1 to Lim\n  if W mod 50 equal 0\n    W print\n  end').replace('rem Pass 2:', '"pass1" print\nrem Pass 2:');
const sourceHash=createHash('sha256').update(source).digest('hex');
let r;const start=performance.now();
r=new Interpreter(x=>{if(process.env.PROGRESS){console.error(JSON.stringify({output:x,ms:performance.now()-start}));}}, {args:[`--lo=${lo}`,`--hi=${hi}`],compilation:mode!=='reference'});
const session=new Session();
try{
 if(process.env.PROFILE){session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
 r.execute(source);
 const expected={'2,10':'2.61969775','10,20':'5.99374121','20,100':'18.71276493','200,500':'20.11208767'}[[lo,hi].join(',')];
 if(expected!==undefined&&String((r.variables.get('Answer') ?? r.lastResult))!==expected)throw Error('wrong answer');
 console.log(JSON.stringify({lo,hi,mode,variant,control:process.env.CONTROL??'',sourceHash,answer:String((r.variables.get('Answer') ?? r.lastResult)),ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,runs:String(r.variables.get('Runs')??r.variables.get('S')),Nb:String(r.variables.get('Nb')),node:process.version,cpu:cpus()[0].model}));
 if(process.env.PROFILE){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session.disconnect();r.dispose();}
