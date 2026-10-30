// node benchmarks/euler268-investigation.mjs [compiled|reference] [variant] [Under=100] [Limit=10000000000000000] [Least=4]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(process.env.RUNTIME ?? process.cwd() + '/packages/interpreter/out/index.js'));
const [mode='compiled',variant='original',under='100',limit='10000000000000000',least='4']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(['original','shipping','eager','ds','sizes','mult','sorted','sorted-q','sorted-eager','sorted-cached','quotient','frontier','recursive','recursive-no-base'].includes(variant));
assert([under,limit,least].every(v => /^\d+$/.test(v)));
let s=readFileSync(new URL(variant === 'shipping' ? '../demos/euler/268_fourprimes.ra' : './experiments/euler268-original.ra', import.meta.url),'utf8').replace('arg Under integer = 100',`arg Under integer = ${under}`).replace('arg Limit integer = 10000000000000000',`arg Limit integer = ${limit}`).replace('arg Least integer = 4',`arg Least integer = ${least}`);
if(variant==='eager') s=s.replace("Ds' =",'Ds =').replace("Sizes' =",'Sizes =').replace("Mult' =",'Mult =');
if(variant==='ds') s=s.replace("Ds' =",'Ds =');
if(variant==='quotient') s=s.replace(/  Fit =[^]*?  Answer \+= .*sum/,`  Q = Max // A
  Answer += (Weights (Kb + Ka I) * (Q // Pb)) sum`);

if(variant.startsWith('sorted')) {
 s=s.replace('use sequences','use sequences\nuse algo').replace('Ks = 0',`Ord = Pb argsort
Pb = Pb Ord
Kb = Kb Ord
Ks = 0`).replace('  Fit = Pb at most (Max // A)',`  Q = Max // A
  N = Pb upperindex Q`).replace('Pb filter Fit array','Pb take N array').replace('Kb filter Fit array','Kb take N array');
 if(variant.startsWith('sorted') && variant!=='sorted') s=s.replace('Max // (A * Ds)','Q // Ds');
}
if(variant.startsWith('recursive')) s=s.slice(0,s.indexOf('H = Ps len'))+`Ks = 0 to (Ps len) array
Sign' = 1 - 2 * ((Ks - Least) mod 2)
Top' = (Ks - 1) max (Least - 1)
Pick' = Top binomial (Least - 1)
Used' = Ks at least Least
Weights = Used choose (Sign * Pick) 0
Count = Ps len
fun From Q K visit
  if From at least Count
    return 0
  end
  Result = 0
  Size = K + 1
  for J in From till Count
    Next = Q // (Ps J)
    if Next equal 0
      break
    end
    Result += (Weights Size) * Next
    Result += (J + 1) Next Size visit
  end
  return Result
end
Answer = 0 Max 0 visit
Answer print
`;
if(variant==='frontier') s=s.slice(0,s.indexOf('H = Ps len'))+`Ks = 0 to (Ps len) array
Sign' = 1 - 2 * ((Ks - Least) mod 2)
Top' = (Ks - 1) max (Least - 1)
Pick' = Top binomial (Least - 1)
Used' = Ks at least Least
Weights = Used choose (Sign * Pick) 0
Ds = array 1
Sizes = array 0
Answer = 0
for P in Ps
  Fit = Ds at most (Max // P)
  New = (Ds filter Fit array) * P
  Ns = (Sizes filter Fit array) + 1
  Answer += (Weights Ns * (Max // New)) sum
  Ds = concat Ds New
  Sizes = concat Sizes Ns
end
Answer print
`;
if(variant==='sorted-cached') s=s.replace('Weights = Used choose (Sign * Pick) 0',`Weights = Used choose (Sign * Pick) 0
Counts' = (0 to H array) reshape (H + 1) 1
BySize = Weights (Counts + Kb)`).replace("  Sizes' = (Kb take N array) + Ka I", "  Row' = BySize (Ka I)\n  W' = Row take N array").replace('Weights Sizes * Mult','W * Mult');
if(variant==='sorted-eager') s=s.replace("Ds' =",'Ds =').replace("Sizes' =",'Sizes =').replace("Mult' =",'Mult =');
if(variant==='recursive-no-base') s=s.replace('  if From at least Count\n    return 0\n  end\n','');
if(variant==='sizes') s=s.replace("Sizes' =",'Sizes =');
if(variant==='mult') s=s.replace("Mult' =",'Mult =');
let scalarCalls=0;
const d=new RuntimeDiagnostics(),r=new Interpreter(()=>{}, {onScalarFunctionExecuted:()=>scalarCalls++,compilation:mode==='compiled'}),t=performance.now();
try {d.run(()=>r.execute(s)); if(under==='100' && limit==='10000000000000000' && least==='4' && String(r.variables.get('Answer'))!=='785478606870985') throw new Error('Wrong full answer'); console.log(JSON.stringify({mode,variant,under,limit,least,ms:performance.now()-t,answer:String(r.variables.get('Answer')),scalarCalls,rss:process.resourceUsage().maxRSS/1024,diagnostics:d}));}finally{r.dispose()}
