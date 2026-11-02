import {performance} from 'node:perf_hooks';
import {Interpreter} from '../packages/interpreter/out/index.js';
import {typedArray} from '../packages/interpreter/out/array-storage.js';
const rows=128,cols=3700,size=rows*cols;
const r=new Interpreter(()=>{});r.execute('use sequences\nuse numbers');
const real=Float64Array.from({length:size},(_,i)=>((i*7919)%cols)/cols);
const bits=Int32Array.from({length:size},(_,i)=>i%cols<20?1:0);
const cuts=Float64Array.from({length:size},(_,i)=>{const k=i%cols,u=250+Math.floor(i/cols);return k<cols/2?Math.min(k/4,u):Math.max(u-(k-cols/2)/4,0);});
r.variables.set('C',typedArray(cuts,[rows,cols]));
r.variables.set('T',typedArray(real,[rows,cols]));r.variables.set('B',typedArray(bits,[rows,cols]));
r.execute(`P = T argsort axis 1\nRw = (0 to ${rows-1}) reshape ${rows} 1\nF = P + Rw * ${cols}\nV = T reshape ${size}`);
const results={};
for(const [name,expression] of Object.entries({argsort:'T argsort axis 1',argsortCuts:'C argsort axis 1',scanPlus:'B scan + axis 1',scanProduct:'B scan * axis 1',scanMin:'B scan min axis 1',gather:'V F'})){
 const times=[];for(let i=0;i<6;i++){const t=performance.now();r.execute(`Result${name} = ${expression}\nResult${name} = Result${name} copy`);if(i)times.push(performance.now()-t);}
 results[name]={ms:times,medianMs:[...times].sort((a,b)=>a-b)[2]};
}
console.log(JSON.stringify({rows,cols,results}));r.dispose();
