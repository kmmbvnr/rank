import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {compileRam,Interpreter} from '../packages/interpreter/out/index.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

// Independent scalar reference; no graph evaluator or tensor backend is used.
const fixtures=[];
const linear=(x,w,b,rows,cin,cout)=>Array.from({length:rows*cout},(_,i)=>{
 const row=Math.floor(i/cout),col=i%cout;let v=b[col];
 for(let k=0;k<cin;k++)v+=x[row*cin+k]*w[k*cout+col];return v;
});
const norm=(x,gain,bias,C)=>x.map((_,i)=>{
 const start=Math.floor(i/C)*C,row=x.slice(start,start+C),mean=row.reduce((a,b)=>a+b,0)/C;
 const variance=row.reduce((a,b)=>a+(b-mean)**2,0)/C;
 return (x[i]-mean)/Math.sqrt(variance+Math.fround(1e-5))*gain[i%C]+bias[i%C];
});
const values=(n,seed,scale)=>Array.from({length:n},(_,i)=>Math.fround(Math.sin(i+seed)*scale));
const literal=(name,shape,items)=>`option ${name} .f32 shape ${shape.join(' ')} = array shape ${shape.join(' ')}\n${items.map(v=>v.toFixed(16)).join(' ')}\nend`;
for(const [B,T,H,D] of [[1,1,1,3],[1,3,2,3],[2,5,2,3]]) {
 const C=H*D, scale=Math.fround(1/Math.sqrt(D));
 const weights=Array.from({length:C*3*C},(_,i)=>Math.fround(Math.sin(i+3)*.2));
 const outWeights=Array.from({length:C*C},(_,i)=>Math.fround(Math.cos(i+5)*.2));
 const g1=values(C,2,.15).map(v=>Math.fround(1+v)),b1=values(C,4,.1),g2=values(C,7,.2).map(v=>Math.fround(1+v)),b2=values(C,8,.1);
 const qkvBias=values(3*C,11,.1),outBias=values(C,13,.1),upW=values(C*4*C,17,.15),upB=values(4*C,19,.1),downW=values(4*C*C,23,.15),downB=values(C,29,.1);
 const mask=Array.from({length:T*T},(_,i)=>i%T>Math.floor(i/T)?-10000:0);
 const base=Array.from({length:B*T*C},(_,i)=>process.argv.includes('--ui') ? i+1 : Math.fround(Math.sin(i+1)*.7));
 let original;
 for(const changed of [false,true]) {
 const input=base.map((v,i)=>changed&&Math.floor(i/C)%T===T-1?Math.fround(v+2*(1+i%C)):v);
 const n1=norm(input,g1,b1,C);
 const p=linear(n1,weights,qkvBias,B*T,C,3*C);
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
 const attention=linear(merged,outWeights,outBias,B*T,C,C);
 const residual1=input.map((v,i)=>v+attention[i]),n2=norm(residual1,g2,b2,C);
 const up=linear(n2,upW,upB,B*T,C,4*C);
 const activated=up.map(x=>.5*x*(1+Math.tanh(Math.sqrt(2/Math.PI)*(x+.044715*x*x*x))));
 const mlp=linear(activated,downW,downB,B*T,4*C,C);
 for(let i=0;i<output.length;i++)output[i]=residual1[i]+mlp[i];
 if(!changed)original=output;else for(let b=0;b<B;b++)for(let t=0;t<T-1;t++)for(let c=0;c<C;c++)assert.equal(output[(b*T+t)*C+c],original[(b*T+t)*C+c]);
 const prefix=`use ml\noption X .f32 shape ${B} ${T} ${C}\n${literal('W',[C,3*C],weights)}\n${literal('O',[C,C],outWeights)}\n${literal('Scale',[1],[scale])}\n${literal('Mask',[1,1,T,T],mask)}\n`;
 const constants=[['G1',[C],g1],['B1',[C],b1],['G2',[C],g2],['B2',[C],b2],['QkvBias',[3*C],qkvBias],['OutBias',[C],outBias],['UpW',[C,4*C],upW],['UpB',[4*C],upB],['DownW',[4*C,C],downW],['DownB',[C],downB]].map(([n,s,v])=>literal(n,s,v)).join('\n')+'\n';
 const lines=[
 'Norm1 = X layernorm * G1 + B1',
 'P = (Norm1 W linear) + QkvBias',
 `Q = (P # # (0 till ${C})) reshape ${B} ${T} ${H} ${D}`,
 `K = (P # # (${C} till ${2*C})) reshape ${B} ${T} ${H} ${D}`,
 `V = (P # # (${2*C} till ${3*C})) reshape ${B} ${T} ${H} ${D}`,
 'Q = Q transpose axis 0 2 1 3','K = K transpose axis 0 2 3 1','V = V transpose axis 0 2 1 3',
 'Scores = Q matmul K rank 2 2 * Scale','Masked = Scores + Mask','Probabilities = Masked softmax',
 'Context = Probabilities matmul V rank 2 2','Merged = Context transpose axis 0 2 1 3',
 `Merged = Merged reshape ${B} ${T} ${C}`,'Attention = (Merged O linear) + OutBias',
 'Residual1 = X + Attention','Norm2 = Residual1 layernorm * G2 + B2',
 'Up = (Norm2 UpW linear) + UpB','Activated = Up gelu_new','Mlp = (Activated DownW linear) + DownB',
 'Output = Residual1 + Mlp'];
 const stages=[['Norm1',0,n1,[B,T,C]],['P',1,p,[B,T,3*C]],['Scores',8,scores,[B,H,T,T]],['Probabilities',10,probabilities,[B,H,T,T]],['Attention',14,attention,[B,T,C]],['Residual1',15,residual1,[B,T,C]],['Norm2',16,n2,[B,T,C]],['Up',17,up,[B,T,4*C]],['Activated',18,activated,[B,T,4*C]],['Mlp',19,mlp,[B,T,C]],['Output',20,output,[B,T,C]]];
 for(const [name,end,expected,outputShape] of stages) {
 const source=prefix+constants+lines.slice(0,end+1).join('\n')+'\nreturn '+name+'\n';
 const graph=compileRam(source,'transformer.ram').graph;assert.deepEqual(graph.outputShape,outputShape);
 fixtures.push({stage:`${B}x${T}x${H}x${D}/${changed?'future-changed':'base'}/${name}`,source,expected,outputShape,input,inputSizes:[input.length],inputShape:[B,T,C],nodeCount:graph.nodes.length,constantBytes:graph.nodes.filter(n=>n.kind==='constant').reduce((sum,n)=>sum+n.values.length*4,0),logicalTensorBytes:graph.nodes.reduce((sum,n)=>sum+n.shape.reduce((a,b)=>a*b,1)*4,0),model:Buffer.from(graph.model).toString('base64')});
 if(B===1&&T===3&&!changed&&name==='Output'&&process.argv.includes('--write-demo'))writeFileSync('demos/mlrank/transformer.ram',source);
 }
 }
}
if(process.argv.includes('--ui')) {
 mkdirSync('output/playwright',{recursive:true});
 const f=fixtures.find(f=>f.stage==='1x1x1x3/base/Output');
 const source=f.source.replace('option X .f32 shape 1 1 3','option X .f32 shape 2 3').replace('Norm1 =','X = (X (0 till 1) #) reshape 1 1 3\nNorm1 =');
 compileRam(source,'dense.ram');
 writeFileSync('output/playwright/ram-transformer-ui.js',readFileSync('packages/web/test/ram-transformer-ui.playwright.js','utf8').replace('__RAM_SOURCE__',JSON.stringify(source)).replace('__EXPECTED__',JSON.stringify(f.expected)));
} else if(process.argv.includes('--android')) {
 mkdirSync('output/playwright',{recursive:true});
 writeFileSync('output/playwright/ram-transformer.js',readFileSync('packages/web/test/ram-transformer.playwright.js','utf8').replace('__RAM_FIXTURES__',JSON.stringify(fixtures)));
} else if(!process.argv.includes('--compile-only')) {
 const checks=[],profiles=[],outputs=new Map();
 const memoryBefore=process.memoryUsage();
 try {for(const f of fixtures) {
 console.error(f.stage);
 const r=new Interpreter(()=>{},{loadModule:name=>({id:name,source:f.source}),ramGpu:nodeRamGpu});
 try {r.execute('use "transformer.ram"');r.variables.set('X',{kind:'array',shape:f.inputShape,items:f.input});
 for(let repeat=0;repeat<3;repeat++) {
 const result=r.execute('X transformer');assert.deepEqual(result.shape,f.outputShape);
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
 if(f.stage.endsWith('/Output')) {
 const loaded=sendRamGpu({action:'load',model:f.model,inputSizes:f.inputSizes});assert.ok(loaded.fullyAccelerated);
 const profile=sendRamGpu({action:'invoke',modelId:loaded.modelId,input:f.input,outputSize:f.expected.length,profile:true});
 assert.ok(profile.fullyAccelerated);assert.equal(profile.output.length,f.expected.length);
 profile.output.forEach((v,i)=>assert.ok(Math.abs(v-f.expected[i])<=1e-5+1e-5*Math.abs(f.expected[i])));
 profiles.push({stage:f.stage,nodeCount:f.nodeCount,modelBytes:Buffer.from(f.model,'base64').length,constantBytes:f.constantBytes,logicalTensorBytes:f.logicalTensorBytes,peakRssBytes:profile.peakRssBytes,executeMs:profile.executeMs});
 sendRamGpu({action:'release',modelId:loaded.modelId});
 }
 }finally{r.dispose();}
 }
 console.log(JSON.stringify({platform:process.platform,fixtureCount:fixtures.length,memoryBefore,memoryAfter:process.memoryUsage(),profiles,tolerance:{atol:1e-5,rtol:1e-5},checks},null,2));
 }finally{closeRamGpu();}
}
