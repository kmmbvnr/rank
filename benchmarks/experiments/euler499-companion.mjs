import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {typedArray} from '../../packages/interpreter/out/array-storage.js';
const [ticket='15',capital='1000000000']=process.argv.slice(2),size=Number(ticket)-1;
const source=readFileSync(new URL('../fixtures/euler499-original.ra',import.meta.url),'utf8')
 .replace('arg T integer = 15',`T = ${ticket}`).replace('arg B integer = 1000000000',`B = ${capital}`);
const r=new Interpreter(()=>{});
const start=performance.now();
function companion(row){const a=new Float64Array(size*size);for(let i=0;i<size-1;i++)a[i*size+i+1]=1;a.set(row,(size-1)*size);return a;}
function mm(a,b){const c=new Float64Array(size*size);for(let i=0;i<size;i++)for(let j=0;j<size;j++){let sum=0;for(let k=0;k<size;k++)sum+=a[i*size+k]*b[k*size+j];c[i*size+j]=sum;}return c;}
function vm(a,b){const c=new Float64Array(size);for(let j=0;j<size;j++){let sum=0;for(let k=0;k<size;k++)sum+=a[k]*b[k*size+j];c[j]=sum;}return c;}
function power(a,n){let out=new Float64Array(size*size);for(let i=0;i<size;i++)out[i*size+i]=1;for(;n;n=Math.floor(n/2)){if(n%2)out=mm(out,a);if(n>1)a=mm(a,a);}return out;}
let last=new Float64Array(size),best=1,stale=0,steps=0;
while(stale<30){
 let base=companion(last),row=new Float64Array(size),next=new Float64Array(size),weight=0.5;row[0]=1;
 for(let n=0;n<50;n++){for(let i=0;i<size;i++)next[i]+=weight*row[i];if(n<49){row=vm(row,base);base=mm(base,base);}weight/=2;}
 let change=0;for(let i=0;i<size;i++)change=Math.max(change,Math.abs(next[i]-last[i]));last=next;steps++;stale++;
 if(change<best){best=change;stale=0;}if(steps>100000)throw Error('Experiment did not converge');
}
const fixedMs=performance.now()-start;
try{
 r.execute(source.slice(0,source.indexOf('X = array shape D D fill 0.0')));
 r.variables.set('X',typedArray(power(companion(last),size),[size,size]));
 r.execute(source.slice(source.indexOf('rem Lowest layer:')));
 console.log(JSON.stringify({ticket,capital,answer:String((r.variables.get('Answer') ?? r.lastResult)),steps,best,fixedMs,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{r.dispose();}
