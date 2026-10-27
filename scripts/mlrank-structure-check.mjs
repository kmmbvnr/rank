import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {compileRam,Interpreter,isRankArray} from '../packages/interpreter/out/index.js';
import {nodeRamGpu,sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

const size=s=>s.reduce((a,b)=>a*b,1);
const coords=(index,shape)=>shape.map((_,i)=>Math.floor(index/size(shape.slice(i+1)))%shape[i]);
const offset=(c,s)=>c.reduce((v,x,i)=>v*s[i]+x,0);
const tensor=(shape,seed=0)=>({shape,items:Array.from({length:size(shape)},(_,i)=>Math.fround(Math.sin(i+seed)*.75))});
const reshape=(a,shape)=>({shape,items:a.items});
const transpose=(a,axes)=>{
 const shape=axes.map(i=>a.shape[i]);
 return {shape,items:Array.from({length:size(shape)},(_,i)=>{
 const c=coords(i,shape),old=[];axes.forEach((axis,j)=>old[axis]=c[j]);return a.items[offset(old,a.shape)];})};
};
const slice=(a,begin,shape)=>({shape,items:Array.from({length:size(shape)},(_,i)=>a.items[offset(coords(i,shape).map((x,j)=>x+begin[j]),a.shape)])});
const concat=(a,b,axis)=>{
 const shape=a.shape.map((n,i)=>i===axis?n+b.shape[i]:n);
 return {shape,items:Array.from({length:size(shape)},(_,i)=>{const c=coords(i,shape);if(c[axis]<a.shape[axis])return a.items[offset(c,a.shape)];c[axis]-=a.shape[axis];return b.items[offset(c,b.shape)];})};
};
const matmul=(a,b)=>{
 const rank=Math.max(a.shape.length,b.shape.length),aa=[...Array(rank-a.shape.length).fill(1),...a.shape],bb=[...Array(rank-b.shape.length).fill(1),...b.shape];
 const shape=aa.slice(0,-2).map((n,i)=>Math.max(n,bb[i])).concat(aa.at(-2),bb.at(-1));
 return {shape,items:Array.from({length:size(shape)},(_,i)=>{const c=coords(i,shape);let sum=0;
 for(let k=0;k<aa.at(-1);k++)sum+=a.items[offset(c.slice(0,-2).map((x,j)=>aa[j]===1?0:x).concat(c.at(-2),k),aa)]*b.items[offset(c.slice(0,-2).map((x,j)=>bb[j]===1?0:x).concat(k,c.at(-1)),bb)];return sum;})};
};
const fixtures=[];
const add=(stage,inputs,body,expected,cpuBody=body)=>{
 const declarations=Object.entries(inputs).map(([name,t])=>'option '+name+' .f32 shape '+t.shape.join(' ')).join('\n');
 const source='use ml\n'+declarations+'\n'+body;
 const graph=compileRam(source,'structure.ram').graph;
 assert.deepEqual(graph.outputShape,expected.shape);
 // Ordinary Rank checks structural syntax and rank semantics against the scalar oracle.
 const cpu=new Interpreter(()=>{});cpu.execute('use sequences\nuse linalg');
 for(const [name,t]of Object.entries(inputs))cpu.variables.set(name,{kind:'array',...t});
 const actual=cpu.execute(cpuBody.replace(/^return /gm,''));
 assert.ok(isRankArray(actual));assert.deepEqual(actual.shape,expected.shape);
 actual.items.forEach((v,i)=>assert.ok(Math.abs(v-expected.items[i])<1e-10,stage+' CPU '+i));
 fixtures.push({stage,inputs,source,expected:expected.items,outputShape:expected.shape,
 input:Object.values(inputs).flatMap(t=>t.items),inputSizes:Object.values(inputs).map(t=>t.items.length),model:Buffer.from(graph.model).toString('base64')});
 cpu.dispose();
};
for(const shape of [[7],[3,7],[2,3,7],[2,2,3,7]]){
 const x=tensor(shape),rank=shape.length;
 add('reshape/'+shape.join('x'),{X:x},'return X reshape '+[size(shape),1].join(' '),reshape(x,[size(shape),1]));
 const axes=shape.map((_,i)=>rank-i-1);
 add('transpose/'+shape.join('x'),{X:x},'return X transpose',transpose(x,axes));
 const begin=shape.map((_,i)=>i===rank-1?1:0),out=shape.map((n,i)=>i===rank-1?n-2:n);
 add('slice/'+shape.join('x'),{X:x},'return X '+Array(rank-1).fill('#').concat('(1 till '+(shape.at(-1)-1)+')').join(' '),slice(x,begin,out));
 add('concat/'+shape.join('x'),{X:x,Y:tensor(shape,3)},'return concat X Y axis '+(rank-1),concat(x,tensor(shape,3),rank-1));
}
for(const [a,b]of [[[3,5],[5,7]],[[2,3,5],[2,5,7]],[[2,2,3,5],[2,2,5,7]],[[2,1,3,5],[1,3,5,7]],[[2,3,5],[5,7]],[[1,1],[1,1]]]){
 const x=tensor(a),y=tensor(b,7);add('matmul/'+a+'-'+b,{X:x,Y:y},'return X matmul Y rank 2 2',matmul(x,y));
}
const three=[tensor([2,3],1),tensor([2,3],2),tensor([2,3],3)];
add('three-runtime-inputs',{X:three[0],Y:three[1],Z:three[2]},'return (X + Y) + Z',
 {shape:[2,3],items:three[0].items.map((v,i)=>v+three[1].items[i]+three[2].items[i])});
const x=tensor([2,3,4]),w=tensor([4,12],9);
const literal='array shape 4 12\n'+w.items.join(' ')+'\nend';
const weight='option W .f32 shape 4 12 = '+literal;
const projection=matmul(x,w);
add('batched-linear',{X:x},weight+'\nreturn X W linear',projection,'W = '+literal+'\nX matmul W rank 2 2');
const q=transpose(reshape(slice(projection,[0,0,0],[2,3,4]),[2,3,2,2]),[0,2,1,3]);
const k=transpose(reshape(slice(projection,[0,0,4],[2,3,4]),[2,3,2,2]),[0,2,3,1]);
const qkv='P = X W linear\nQ = (P # # (0 till 4)) reshape 2 3 2 2\nK = (P # # (4 till 8)) reshape 2 3 2 2\nQ = Q transpose axis 0 2 1 3\nK = K transpose axis 0 2 3 1\nreturn Q matmul K rank 2 2';
add('qkv-heads-qkt',{X:x},weight+'\n'+qkv,matmul(q,k),'W = '+literal+'\n'+qkv.replace('X W linear','X matmul W rank 2 2'));
add('transpose-slice-concat',{X:tensor([2,3,7])},'T = X transpose axis 2 0 1\nS = T (1 to 5) # (0 till 2)\nreturn concat S S axis 1',(()=>{const t=transpose(tensor([2,3,7]),[2,0,1]),s=slice(t,[1,0,0],[5,2,2]);return concat(s,s,1)})());
if(process.argv.includes('--android')){
 mkdirSync('output/playwright',{recursive:true});
 writeFileSync('output/playwright/ram-structure.js',readFileSync('packages/web/test/ram-structure.playwright.js','utf8').replace('__RAM_FIXTURES__',JSON.stringify(fixtures)));
}else{
 const checks=[];
 try{for(const f of fixtures){
 console.error(f.stage);
 const r=new Interpreter(()=>{},{loadModule:name=>({id:name,source:f.source}),ramGpu:nodeRamGpu});
 r.execute('use "structure.ram"');
 for(const [name,t]of Object.entries(f.inputs))r.variables.set(name,{kind:'array',...t});
 const names=Object.keys(f.inputs),call=names[0]+' structure '+names.slice(1).join(' ');
 for(let repeat=0;repeat<3;repeat++){
 const result=r.execute(call);assert.deepEqual(result.shape,f.outputShape);
 const errors=result.items.map((v,i)=>Math.abs(v-f.expected[i]));
 errors.forEach((e,i)=>assert.ok(Number.isFinite(e)&&e<=1e-5+1e-5*Math.abs(f.expected[i]),f.stage+' cell '+i+': '+result.items[i]+' != '+f.expected[i]));
 checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),fullyAccelerated:true});
 }r.dispose();}
 console.log(JSON.stringify({platform:process.platform,fixtureCount:fixtures.length,cpuRankCompared:true,tolerance:{atol:1e-5,rtol:1e-5},checks},null,2));
 }finally{closeRamGpu();}
}
