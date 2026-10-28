import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {compileRam,Interpreter} from '../packages/interpreter/out/index.js';
import {nodeRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

// Independent scalar reference; no graph evaluator or tensor backend is used.
const fixtures=[];
const literal=(name,shape,items)=>`option ${name} .f32 shape ${shape.join(' ')} = array shape ${shape.join(' ')}\n${items.map(v=>v.toFixed(16)).join(' ')}\nend`;
for(const [B,T,H,D] of [[1,1,1,3],[1,3,2,3],[2,5,2,3]]) {
 const C=H*D, scale=Math.fround(1/Math.sqrt(D));
 const weights=Array.from({length:C*3*C},(_,i)=>Math.fround(Math.sin(i+3)*.2));
 const outWeights=Array.from({length:C*C},(_,i)=>Math.fround(Math.cos(i+5)*.2));
 const mask=Array.from({length:T*T},(_,i)=>i%T>Math.floor(i/T)?-10000:0);
 const base=Array.from({length:B*T*C},(_,i)=>Math.fround(Math.sin(i+1)*.7));
 let original;
 for(const changed of [false,true]) {
 const input=base.map((v,i)=>changed&&Math.floor(i/C)%T===T-1?Math.fround(v+2):v);
 const p=Array(B*T*3*C).fill(0);
 for(let n=0;n<B*T;n++)for(let j=0;j<3*C;j++)for(let k=0;k<C;k++)p[n*3*C+j]+=input[n*C+k]*weights[k*3*C+j];
 const scores=[],masked=[],probabilities=[],context=Array(B*H*T*D).fill(0),merged=Array(B*T*C).fill(0),output=Array(B*T*C).fill(0);
 for(let b=0;b<B;b++)for(let h=0;h<H;h++)for(let t=0;t<T;t++) {
 const row=[];
 for(let s=0;s<T;s++) {
 let dot=0;for(let d=0;d<D;d++)dot+=p[(b*T+t)*3*C+h*D+d]*p[(b*T+s)*3*C+C+h*D+d];
 scores.push(dot*scale);row.push(dot*scale+mask[t*T+s]);
 }
 masked.push(...row);const max=Math.max(...row),exps=row.map(v=>Math.exp(v-max)),sum=exps.reduce((a,b)=>a+b,0),probs=exps.map(v=>v/sum);
 assert.ok(Math.abs(probs.reduce((a,b)=>a+b,0)-1)<1e-12);
 for(let s=t+1;s<T;s++)assert.equal(probs[s],0);
 probabilities.push(...probs);
 for(let d=0;d<D;d++) {
 let v=0;for(let s=0;s<T;s++)v+=probs[s]*p[(b*T+s)*3*C+2*C+h*D+d];
 context[((b*H+h)*T+t)*D+d]=v;merged[(b*T+t)*C+h*D+d]=v;
 }
 }
 for(let n=0;n<B*T;n++)for(let j=0;j<C;j++)for(let k=0;k<C;k++)output[n*C+j]+=merged[n*C+k]*outWeights[k*C+j];
 if(!changed)original=output;else for(let b=0;b<B;b++)for(let t=0;t<T-1;t++)for(let c=0;c<C;c++)assert.equal(output[(b*T+t)*C+c],original[(b*T+t)*C+c]);
 const prefix=`use ml\noption X .f32 shape ${B} ${T} ${C}\n${literal('W',[C,3*C],weights)}\n${literal('O',[C,C],outWeights)}\n${literal('Scale',[1],[scale])}\n${literal('Mask',[1,1,T,T],mask)}\n`;
 const lines=[
 'P = X W linear',
 `Q = (P # # (0 till ${C})) reshape ${B} ${T} ${H} ${D}`,
 `K = (P # # (${C} till ${2*C})) reshape ${B} ${T} ${H} ${D}`,
 `V = (P # # (${2*C} till ${3*C})) reshape ${B} ${T} ${H} ${D}`,
 'Q = Q transpose axis 0 2 1 3','K = K transpose axis 0 2 3 1','V = V transpose axis 0 2 1 3',
 'Scores = Q matmul K rank 2 2 * Scale','Masked = Scores + Mask','Probabilities = Masked softmax',
 'Context = Probabilities matmul V rank 2 2','Merged = Context transpose axis 0 2 1 3',
 `Merged = Merged reshape ${B} ${T} ${C}`,'Output = Merged O linear'];
 const stages=[['Scores',7,scores,[B,H,T,T]],['Masked',8,masked,[B,H,T,T]],['Probabilities',9,probabilities,[B,H,T,T]],['Context',10,context,[B,H,T,D]],['Merged',12,merged,[B,T,C]],['Output',13,output,[B,T,C]]];
 for(const [name,end,expected,outputShape] of stages) {
 const source=prefix+lines.slice(0,end+1).join('\n')+'\nreturn '+name+'\n';
 const graph=compileRam(source,'attention.ram').graph;assert.deepEqual(graph.outputShape,outputShape);
 fixtures.push({stage:`${B}x${T}x${H}x${D}/${changed?'future-changed':'base'}/${name}`,source,expected,outputShape,input,inputSizes:[input.length],inputShape:[B,T,C],model:Buffer.from(graph.model).toString('base64')});
 if(B===1&&T===3&&!changed&&name==='Output'&&process.argv.includes('--write-demo'))writeFileSync('demos/mlrank/attention.ram',source);
 }
 }
}
if(process.argv.includes('--android')) {
 mkdirSync('output/playwright',{recursive:true});
 writeFileSync('output/playwright/ram-attention.js',readFileSync('packages/web/test/ram-attention.playwright.js','utf8').replace('__RAM_FIXTURES__',JSON.stringify(fixtures)));
} else if(!process.argv.includes('--compile-only')) {
 const checks=[],outputs=new Map();
 try {for(const f of fixtures) {
 console.error(f.stage);
 const r=new Interpreter(()=>{},{loadModule:name=>({id:name,source:f.source}),ramGpu:nodeRamGpu});
 try {r.execute('use "attention.ram"');r.variables.set('X',{kind:'array',shape:f.inputShape,items:f.input});
 for(let repeat=0;repeat<3;repeat++) {
 const result=r.execute('X attention');assert.deepEqual(result.shape,f.outputShape);
 const errors=result.items.map((v,i)=>Math.abs(v-f.expected[i]));
 errors.forEach((e,i)=>assert.ok(Number.isFinite(e)&&e<=1e-5+1e-5*Math.abs(f.expected[i]),`${f.stage} cell ${i}: ${result.items[i]} != ${f.expected[i]}`));
 if(f.stage.endsWith('/Probabilities')) {
 const T=f.outputShape.at(-1);
 for(let row=0;row<result.items.length/T;row++) {
 const values=result.items.slice(row*T,(row+1)*T);assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-1)<1e-5);
 for(let j=row%T+1;j<T;j++)assert.equal(values[j],0);
 }
 }
 if(f.stage.endsWith('/Output')) {
 const key=f.stage.replace('future-changed','base');
 if(f.stage.includes('future-changed')) {const base=outputs.get(key),[B,T,C]=f.inputShape;for(let b=0;b<B;b++)for(let t=0;t<T-1;t++)for(let c=0;c<C;c++)assert.ok(Math.abs(result.items[(b*T+t)*C+c]-base[(b*T+t)*C+c])<1e-5);}
 else outputs.set(key,result.items);
 }
 checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),fullyAccelerated:true});
 }
 }finally{r.dispose();}
 }
 console.log(JSON.stringify({platform:process.platform,fixtureCount:fixtures.length,tolerance:{atol:1e-5,rtol:1e-5},checks},null,2));
 }finally{closeRamGpu();}
}
