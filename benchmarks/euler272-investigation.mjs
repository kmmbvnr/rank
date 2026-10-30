import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',variant='original',limit='1000000000']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(limit) && BigInt(limit)>0n);
let source=readFileSync(new URL('./experiments/euler272-original.ra',import.meta.url),'utf8').replace('arg Limit integer = 100000000000',`arg Limit integer = ${limit}`);
if(['scaled','batched','tight','batched-tight','helper-tight','matrix','matrix-tight','flat-tight','flat-batched-tight','vector-tight'].includes(variant)) source=source.replace('Limit // 53599','Limit // 482391')
 .replace('  Pw = 9','  Pw = 1')
 .replace('            M = Limit // A5','            M = Lim // A5')
 .replace('            Total += A5 * Sm','            if Mode equal 1\n              Sm = 9 * Sm\n            end\n            Total += A5 * Sm');
if(variant.startsWith('batched') || variant==='helper-tight' || variant==='flat-batched-tight' || variant==='vector-tight') {
 source=source.replace('Fl = array shape 400 fill 0', `PrimeSum = array shape (Np + 1) fill 0
for I in 0 till Np
  PrimeSum (I + 1) = PrimeSum I + P1 I
end
Fl = array shape 400 fill 0`);
 let batch=(a,first,weight,indent)=>`for Qb in 1 to 6
  Low = (Lim // (${a} * (Qb + 1))) max (P1 ((${first}) - 1))
  High = Lim // (${a} * Qb)
  Left = 0
  Right = Np
  for Left less Right
    Mid = (Left + Right) // 2
    if P1 Mid at most Low
      Left = Mid + 1
    else
      Right = Mid
    end
  end
  Start = Left
  Right = Np
  for Left less Right
    Mid = (Left + Right) // 2
    if P1 Mid at most High
      Left = Mid + 1
    else
      Right = Mid
    end
  end
  if Left greater Start
    Total += ${weight} * ${a} * (Vt Qb) * (PrimeSum Left - PrimeSum Start)
  end
end`.split('\n').map(x=>indent+x).join('\n');
 if(variant==='helper-tight' || variant==='flat-batched-tight') {
 source=source.replace('Fl = array shape 400 fill 0', `fun X prime_sum
  Left = 0
  Right = Np
  for Left less Right
    Mid = (Left + Right) // 2
    if P1 Mid at most X
      Left = Mid + 1
    else
      Right = Mid
    end
  end
  return PrimeSum Left
end
Fl = array shape 400 fill 0`);
 batch=(a,first,weight,indent)=>`for Qb in 1 to 6
  Low = (Lim // (${a} * (Qb + 1))) max (P1 ((${first}) - 1))
  High = Lim // (${a} * Qb)
  if High greater Low
    Total += ${weight} * ${a} * (Vt Qb) * ((High prime_sum) - (Low prime_sum))
  end
end`.split('\n').map(x=>indent+x).join('\n');
 }
 if(variant==='vector-tight') {
 source=source.replace('use sequences','use sequences\nuse algo');
 source=source.replace('Fl = array shape 400 fill 0','Qs = 1 to 6 array\nFl = array shape 400 fill 0');
 batch=(a,first,weight,indent)=>`Low = (Lim // (${a} * (Qs + 1))) max (P1 ((${first}) - 1))
High = (Lim // (${a} * Qs)) max Low
Starts = P1 upperindex Low
Stops = P1 upperindex High
Weights = Vt Qs
Total += ${weight} * ${a} * (Weights * (PrimeSum Stops - PrimeSum Starts)) sum`.split('\n').map(x=>indent+x).join('\n');
 }
 source=source.replace('        for I4 in (I3 + 1) till Np', `        if Mode equal 1
${batch('A3','I3 + 1','9','          ')}
        end
        for I4 in (I3 + 1) till Np`);
 source=source.replace('          Fp 3 = P1 I4', `          if Mode equal 1 and A3 * P1 I4 greater Lim // 7
            break
          end
          Fp 3 = P1 I4`);
 source=source.replace('          for I5 in Lo5 to Hi5', `          if Mode equal 0
${batch('A4','I4 + 1','1','            ')}
          end
          for I5 in Lo5 to Hi5`);
 source=source.replace('            P5 = P1 I5', `            if Mode equal 0 and A4 * P1 I5 greater Lim // 7
              break
            end
            P5 = P1 I5`);
}
if(variant.includes('tight')) {
 for(const [depth,indent] of [[1,'    '],[2,'      '],[3,'        '],[4,'          ']]) {
  const i=`I${depth}`;
  const need=5-depth;
  let check=`${indent}if ${i} + ${need} - Mode at least Np\n${indent}  break\n${indent}end\n`;
  check+=`${indent}Minimum = ${depth===1?'1':`A${depth-1}`} * P1 ${i}\n`;
  if(need) check+=`${indent}for Next in 1 to (${need} - Mode)\n${indent}  Minimum = Minimum * P1 (${i} + Next)\n${indent}end\n`;
  check+=`${indent}if Minimum greater Lim\n${indent}  break\n${indent}end\n`;
  source=source.replace(`${indent}Fp ${depth-1} = P1 ${i}`,check+`${indent}Fp ${depth-1} = P1 ${i}`);
 }
}
assert(['original','scaled','batched','tight','batched-tight','helper-tight','matrix','matrix-tight','flat-tight','flat-batched-tight','vector-tight','shipping'].includes(variant));
if(variant.startsWith('matrix')) source=source
 .replace('Fl = array shape 400 fill 0','Vt = (concat Va Vb) reshape 2 (Mm + 1)\nFl = array shape 400 fill 0')
 .replace('  Vt = Va\n','').replace('    Vt = Vb\n','')
 .replace('Vt M','Vt Mode M').replace('Vt (M // Fq)','Vt Mode (M // Fq)');
if(variant.startsWith('flat')) source=source
 .replace('Fl = array shape 400 fill 0','Vt = concat Va Vb array\nFl = array shape 400 fill 0')
 .replace('  Vt = Va\n','').replace('    Vt = Vb\n','')
 .replace('Vt M','Vt (Mode * (Mm + 1) + M)').replace('Vt (M // Fq)','Vt (Mode * (Mm + 1) + M // Fq)')
 .replace('Vt Qb','Vt (Mode * (Mm + 1) + Qb)');
if(variant==='shipping') source=readFileSync(new URL('../demos/euler/272_modularcubes.ra',import.meta.url),'utf8').replace('arg Limit integer = 100000000000',`arg Limit integer = ${limit}`);
if(process.env.DUMP_SOURCE) { process.stdout.write(source); process.exit(0); }
const stages=[];
if(process.env.STAGES) for(const [target,label] of [['Pre = array','sieve'],['Va = array','prefix'],['Fl = array','tables'],['Answer = Total','search']]) source=source.replace(target,`"${label}" print\n${target}`);
let previous=performance.now();
const runtime=new Interpreter(value=>{const now=performance.now(); stages.push({label:String(value),ms:now-previous});previous=now;},{compilation:mode==='compiled'});
const diagnostics=new RuntimeDiagnostics();
const start=performance.now();
try {
 if(process.env.DIAGNOSTICS) diagnostics.run(()=>runtime.execute(source)); else runtime.execute(source);
 const answer=String(runtime.variables.get('Answer'));
 const expected={'10000000':'4222148009','1000000000':'316174709149021','100000000000':'8495585919506151122'}[limit];
 if(expected) assert.equal(answer,expected);
 console.log(JSON.stringify({mode,variant,limit,ms:performance.now()-start,answer,rssMiB:process.resourceUsage().maxRSS/1024,stages,...(process.env.DIAGNOSTICS?{diagnostics}:{})}));
}finally{runtime.dispose()}
