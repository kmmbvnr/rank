import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const{Interpreter}=await import(process.env.RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
function oracle(n){const primes=[];for(let p=2;p<=n;p++)if(primes.every(q=>p%q))primes.push(p);let dp=new Map([[0,0]]);for(let v=1;v<=n;v++){let mask=0;primes.forEach((p,i)=>{if(v%p===0)mask|=1<<i});for(const[m,w]of [...dp])if(!(m&mask))dp.set(m|mask,Math.max(dp.get(m|mask)||0,w+v));}return BigInt(Math.max(...dp.values()));}
const original = readFileSync(new URL('./experiments/euler355-original.ra', import.meta.url), 'utf8');
const fixed = original.replace('Large = Pr filter not Lo array', 'Large = Pr filter Pr greater Root array');
const safe = fixed.replace('fun S R W hungarian\n', 'fun S R W hungarian\n  if S equal 0\n    return 0\n  end\n').replace('Inf = 10 ** 30', 'Inf = (W max + 1) * (S + 1)');
const sources = {production: readFileSync(new URL('../demos/euler/355_coprime.ra',import.meta.url),'utf8'), fixed, safe, half: safe.replace('Large = Pr filter Pr greater Root array', 'Large = Pr filter Pr greater Root array\nLarge = Large filter Large at most Limit // 2 array'), bound: readFileSync(new URL('./experiments/euler355-bounded.ra', import.meta.url), 'utf8')};
let checks=0;for(const variant of ['production','fixed','safe','half','bound'])for(const compilation of[false,true])for(const n of[1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,100]){const r=new Interpreter(()=>{},{compilation});try{let s=sources[variant].replace('arg Limit integer = 200000',`Limit = ${n}`);r.execute(s);assert.equal((r.variables.get('Answer') ?? r.lastResult),n===100?1356n:oracle(n),`${variant}/${compilation}/${n}`);checks++;}finally{r.dispose()}}
const fixture = fileURLToPath(new URL('../demos/euler/355_coprime_test.ra', import.meta.url));
for (const compilation of [false, true]) {
 const r = new Interpreter(() => {}, {compilation, testing: true, sourceId: fixture,
  loadModule(specifier, from) {
   const id = resolve(dirname(from ?? fixture), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
   return {id, source: readFileSync(id, 'utf8')};
  }});
 try {r.execute(readFileSync(fixture, 'utf8'));assert.equal(r.testResults.length,1);assert(r.testResults.every(t=>t.passed),JSON.stringify(r.testResults));checks++;} finally {r.dispose();}
}
console.log(JSON.stringify({checks,fixture: 'production fixture passes in both engines',oracle:'independent prime-mask subset DP through 30; known 100=1356'}));
