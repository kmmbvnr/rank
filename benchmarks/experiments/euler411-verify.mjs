import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const original=readFileSync(new URL('./euler411-original.ra', import.meta.url),'utf8');
function oracle(n){const points=[];let x=1%n,y=1%n;for(let i=0;i<=2*n;i++){points.push([x,y]);x=x*2%n;y=y*3%n;}points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const tails=[];let previous='';for(const [x,y]of points){const key=x+','+y;if(key===previous)continue;previous=key;let lo=0,hi=tails.length;while(lo<hi){let m=(lo+hi)>>>1;if(tails[m]<=y)lo=m+1;else hi=m;}tails[lo]=y;}return BigInt(tails.length);}
let checks=0;const cases=[...Array.from({length:32},(_,i)=>i+1),50,81,123,128,243,729,10000];
for(const variant of ['original','append','three','combined']){
 let src=original;
if(variant==='grow' || variant==='combined')src=src.replace('Tl = array shape Len fill 0','Tl = array shape (Len min 1024) fill 0').replace('      Tl Lo = V','      if Lo equal (Tl len)\n        Tl = concat Tl Tl copy\n      end\n      Tl Lo = V');
if(variant==='combined')src=src.replace('  Len = 2 * N', '  if N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');
if(variant==='append')src=src.replace('      Lo = 0\n      Hi = Ln', '      if Ln greater 0\n        if Tl (Ln - 1) at most V\n          Tl Ln = V\n          Ln += 1\n          continue\n        end\n      end\n      Lo = 0\n      Hi = Ln');
if(variant==='three')src=src.replace('  Len = 2 * N', '  if N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');
if(variant==='axis')src=src.replace('  Len = 2 * N', '  if N2 equal 1 or N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');

 for(const compilation of [false,true])for(const n of cases){const r=new Interpreter(()=>{},{compilation,args:[`--first=${n}`,`--count=${n}`,'--power=1']});try{r.execute(src);assert.equal((r.variables.get('Answer') ?? r.lastResult),oracle(n),`${variant} ${compilation} n=${n}`);checks++;}finally{r.dispose();}}
}
console.log(JSON.stringify({checks,cases:cases.length,variants:4,engines:2}));
