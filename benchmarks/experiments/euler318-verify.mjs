import {readFileSync} from 'node:fs';
const root=process.env.RANK_ROOT||process.cwd();
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
let total=0;const full=[];
for(const top of [2,3,4,5,6,7,10,15,20,25,40,64,100])for(const nines of [0,1,2,3,11,2011]) {
 let expected=0;
 for(let p=1;p<top;p++)for(let q=p+1;p+q<=top;q++) if((q-p-1)**2<4*p){const beta=(q-p)/(Math.sqrt(q)+Math.sqrt(p));expected+=Math.ceil(nines*Math.LN10/(-2*Math.log(beta)));}
 for(const mode of ['reference','compiled','exact'])for(const variant of ['original','bounded','break','stable','production']){
 let s=readFileSync(variant==='production' ? new URL('../../demos/euler/318_nines.ra',import.meta.url) : new URL('./euler318-original.ra',import.meta.url),'utf8').replace('arg Top integer = 2011',`arg Top integer = ${top}`).replace('arg Nines integer = 2011',`arg Nines integer = ${nines}`);
 if(variant==='bounded')s=s.replace('for Q in P + 1 to Top - P','End = (Top - P) min (P + 1 + ((4 * P) isqrt))\n  for Q in P + 1 to End');
 if(variant==='break')s=s.replace('if Beta less 1.0','if not (Beta less 1.0)\n      break\n    end\n    if Beta less 1.0');
 if(variant==='stable')s=s.replace('Beta = (Q sqrt) - (P sqrt)','Beta = (Q - P) / ((Q sqrt) + (P sqrt))');
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});try{r.execute(s);if(String(r.variables.get('Answer'))!==String(expected))throw Error(JSON.stringify({top,nines,variant,mode,expected,actual:String(r.variables.get('Answer'))}));total++;}finally{r.dispose()}
 }
}
console.log(JSON.stringify({checks:total,node:process.version}));
