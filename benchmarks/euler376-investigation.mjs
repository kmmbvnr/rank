import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Session} from 'node:inspector/promises';
const {Interpreter,RuntimeDiagnostics}=await import(new URL(process.env.RUNTIME||'../packages/interpreter/out/index.js',import.meta.url));
const [file='demos/euler/376_dice.ra',mode='compiled',requestedLimit]=process.argv.slice(2);
let source=readFileSync(file,'utf8');
const limit=requestedLimit??(source.includes('rem Nontransitive Sets of Dice')?'30':undefined);
if(process.env.PHASES)source=source.replace(/^(  Keys = New[^\n]*)$/m,'$1\n  "phase" print\n  V print');
const phases=[],d=new RuntimeDiagnostics();let answer,last,start,phaseNext=false;
const r=new Interpreter(text=>{const now=performance.now();if(process.env.PHASES&&text==='phase'){phaseNext=true;return;}if(phaseNext){phaseNext=false;const cur=r.variables.get('Cur'),keys=r.variables.get('Keys');phases.push({v:Number(text),ms:now-last,states:cur?.entries?.size,queue:keys?.items?.length});last=now;}else answer=text;},{compilation:mode!=='reference',args:limit===undefined?[]:['--limit',limit]});
let session;if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
start=last=performance.now();
try{if(process.env.DIAG)d.run(()=>r.execute(source));else r.execute(source);const expected=source.includes('rem Nontransitive Sets of Dice')?{'6':'581','10':'4995047','30':'973059630185670'}[limit]:undefined;if(expected)assert.equal(answer,expected);console.log(JSON.stringify({file,mode,limit,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,phases,...(process.env.DIAG?{diagnostics:d}:{})}));if(session){const{profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}}finally{r.dispose();session?.disconnect();}
