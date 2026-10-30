// Original, experimental and shipping variants: node benchmarks/euler269-investigation.mjs [compiled|reference] [variant] [K=16]
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter, RuntimeDiagnostics}=await import(pathToFileURL(process.env.RUNTIME ?? process.cwd()+'/packages/interpreter/out/index.js'));
const [mode='compiled',variant='original',k='16']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(k) && Number(k)>0);
assert(['shipping','original','pruned','early','compact','early-up','eager','early-eager','broadcast','broadcast-eager','broadcast-terminal'].includes(variant) || /^broadcast-one-(Col|Lag|Cum|Tl|Nx|Hd|Pc|Hit|Done)$/.test(variant));
let source=readFileSync(new URL(variant==='shipping' ? '../demos/euler/269_integerroot.ra' : './experiments/euler269-original.ra',import.meta.url),'utf8').replace('arg K integer = 16',`arg K integer = ${Number(k)}`);
if(variant==='pruned') source=source.replace('  D = G len - 1','  if G 0 greater 9\n    continue\n  end\n  D = G len - 1');
if(['early','early-eager','early-up','broadcast','broadcast-eager','broadcast-terminal'].includes(variant) || variant.startsWith('broadcast-one-')) source=source.replace('  G = array 1','  if (Rs reduce *) greater 9\n    continue\n  end\n  G = array 1');
if(variant==='compact') source=source.replace('Base = 2001\nOff = 1000','Off = 9 * K + 1\nBase = 2 * Off + 1').replace('  G = array 1','  if (Rs reduce *) greater 9\n    continue\n  end\n  G = array 1');
if(variant==='early-up') for(const name of ['Up','Sh']) source=source.replace(`${name}' =`,`${name} =`);
if(['eager','early-eager'].includes(variant)) for(const name of ['Col','Lag','Nk','Na','Ca','Cum','Tl','Nx','Hd','Pc','Hit','Done']) source=source.replace(`${name}' =`,`${name} =`);
if(variant.startsWith('broadcast')) {
 source=source.replace('    NK = array shape 0 fill 0\n    NC = NK\n','');
 const from=source.indexOf('    for P in Lo to Hi');
 const to=source.indexOf('    Keys = NK',from);
 source=source.slice(0,from)+`    Width = Hi - Lo + 1
    Digits = (Lo to Hi array) reshape Width 1
    Acc = Digits - Back
    Q = Acc // Lead
    Fit = Acc mod Lead equal 0
    Fit = Fit and (Q at most Off - 1)
    Fit = Fit and (Q at least 1 - Off)
    Cells = Width * N
    Masked = Fit reshape Cells
    Next' = ((Q + Off) + Base * Tail) reshape Cells
    Counts' = (Cnts + Digits * 0) reshape Cells
    NK = Next filter Masked array
    NC = Counts filter Masked array
`+source.slice(to);
 if(variant.startsWith('broadcast-one-')) source=source.replace(`${variant.slice('broadcast-one-'.length)}' =`,`${variant.slice('broadcast-one-'.length)} =`);
 if(['broadcast-eager','broadcast-terminal'].includes(variant)) for(const name of ['Col','Lag','Cum','Tl','Nx','Hd','Pc','Hit','Done']) source=source.replace(`${name}' =`,`${name} =`);
}
if(variant==='broadcast-terminal') source=source.replace('0 till (K + D)','0 till K').replace('    Cells = Width * N','    if I at least K - D\n      Fit = Fit and (Q equal 0)\n    end\n    Cells = Width * N');
let scalarCalls=0;
const runtime=new Interpreter(()=>{}, {compilation:mode==='compiled',onScalarFunctionExecuted:()=>scalarCalls++}),diagnostics=new RuntimeDiagnostics();
const start=performance.now();
try {
 diagnostics.run(()=>runtime.execute(source));
 const answer=String(runtime.variables.get('Answer'));
 if(k==='16') assert.equal(answer,'1311109198529286');
 if(k==='3') assert.equal(answer,'172');
 if(k==='5') assert.equal(answer,'14696');
 console.log(JSON.stringify({mode,variant,k,ms:performance.now()-start,answer,rssMiB:process.resourceUsage().maxRSS/1024,scalarCalls,diagnostics}));
}finally{runtime.dispose()}
