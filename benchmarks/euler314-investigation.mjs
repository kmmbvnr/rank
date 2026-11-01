import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',grid='25',variant='original'] = process.argv.slice(2);
assert.ok(['compiled','reference','exact','prefix'].includes(mode));
assert.ok(['original','continuous','inline','inline-continuous','production'].includes(variant));
assert.ok(/^\d+$/.test(grid) && Number(grid)>0);
let s=readFileSync(new URL(variant==='production'?'../demos/euler/314_mousemoon.ra':'./experiments/euler314-original.ra',import.meta.url),'utf8').replace('arg Grid integer = 250',`arg Grid integer = ${grid}`);
if(variant.includes('inline')) s=s.replace('          J = A SA Y Sy D R G cross',`          K = Y - A
          Diff = Sy - SA
          if Diff at least 0.0
            J = Y
          elif Diff + R * K at most 0.0
            J = G + 1
          else
            C = (SA - Sy) / R
            Q = K * K - C * C
            Z = 1.0 + 4 * D * D / Q
            U = (-K + C * Z ** 0.5) / 2
            J = (Y + U) floor
            if J less Y
              J = Y
            end
            for J at most G
              DB = J - Y
              DA = J - A
              QB = D * D + DB * DB
              QA = D * D + DA * DA
              FB = Sy - R * QB ** 0.5
              FA = SA - R * QA ** 0.5
              if FB at least FA - 0.0000000000001
                break
              end
              J += 1
            end
          end`);
if(variant.includes('continuous')) s=s.replace('Answer = 130.87', 'Pi = (-1) acos\nAnswer = 2 * Grid / (2 + Pi ** 0.5)');
const i=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',scalarFunctionCompilation:mode!=='prefix'});const d=new RuntimeDiagnostics();
i.execute('');
const t=performance.now(),c=process.cpuUsage();
try{if(process.env.DIAGNOSTICS) d.run(()=>i.execute(s)); else i.execute(s); const cpu=process.cpuUsage(c),ms=performance.now()-t,rssMiB=process.resourceUsage().maxRSS/1024,answer=i.variables.get('Answer');
if(Number(grid)===250) assert.equal(answer.toFixed(8),'132.52756426');
if(Number(grid)<=25) assert.ok(Math.abs(answer-oracle(Number(grid)))<1e-10, String(answer));
console.log(JSON.stringify({mode,grid,variant,ms,cpuMs:(cpu.user+cpu.system)/1000,rssMiB,answer,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{i.dispose()}

// Exhaustive predecessor enumeration, independent of the envelope and cross().
function oracle(grid) {
 let ratio=130.87;
 for(let round=0;round<12;round++) {
  const rows=Array.from({length:grid+1},()=>[]);
  for(let y=0;y<=grid;y++) rows[0][y]={area:0,length:y};
  for(let x1=1;x1<=grid;x1++) for(let y1=0;y1<=grid;y1++) {
   let score=-Infinity;
   for(let x=0;x<x1;x++) for(let y=0;y<=y1;y++) {
    const prev=rows[x][y],area=prev.area+(x1-x)*(y+y1)/2;
    const length=prev.length+Math.hypot(x1-x,y1-y),s=area-ratio*length;
    if(s>score) { score=s; rows[x1][y1]={area,length}; }
   }
  }
  const best=rows[grid][grid],next=best.area/best.length;
  if(Math.abs(next-ratio)<1e-12) return next;
  ratio=next;
 }
 return ratio;
}
