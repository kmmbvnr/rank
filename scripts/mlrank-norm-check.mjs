import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {compileRam, Interpreter, isRankArray} from '../packages/interpreter/out/index.js';
import {sendRamGpu,closeRamGpu} from '../packages/cli/out/ram-gpu.js';

const fixtures=[];
const gelu=x=>0.5*x*(1+Math.tanh(Math.sqrt(2/Math.PI)*(x+0.044715*x*x*x)));
const norm=(input,width,epsilon)=>input.flatMap((_,i)=>{
    if(i%width) return [];
    const row=input.slice(i,i+width),mean=row.reduce((s,x)=>s+x,0)/width;
    const variance=row.reduce((s,x)=>s+(x-mean)**2,0)/width;
    return row.map(x=>(x-mean)/Math.sqrt(variance+epsilon));
});
const add=(stage,shape,input,body,expected)=>{
    input=input.map(Math.fround);
    const source='use ml\noption X .f32 shape '+shape.join(' ')+'\n'+body;
    const graph=compileRam(source,'norm.ram').graph;
    const tolerance = 1e-5;
    fixtures.push({tolerance,stage,shape,input,source,expected:expected(input),outputShape:graph.outputShape,
        model:Buffer.from(graph.model).toString('base64')});
};
for(const shape of [[7],[3,7],[2,3,7],[2,2,3,7],[3,1],[2,768]]){
    const size=shape.reduce((a,b)=>a*b,1),width=shape.at(-1);
    for(const [name,values] of [
        ['mixed',Array.from({length:size},(_,i)=>Math.sin(i*0.7)*3)],
        ['constant-offset',Array(size).fill(1000.25)],
        ['constant',Array.from({length:size},(_,i)=>Math.floor(i/width)-2)],
        ['small-variance',Array.from({length:size},(_,i)=>1+(i%width)*1e-5)],
        ['offset',Array.from({length:size},(_,i)=>1000+(i%width)*0.125)],
    ]){
        add('layernorm/'+shape.join('x')+'/'+name,shape,values,'return X layernorm',x=>norm(x,width,1e-5));
    }
}
for(const shape of [[13],[2,13],[2,2,13],[2,2,2,13]]){
 const size=shape.reduce((a,b)=>a*b,1);
 const values=Array.from({length:size},(_,i)=>[-20,-8,-3,-1,-0.1,-1e-4,0,1e-4,0.1,1,3,8,20][i%13]);
 add('gelu/'+shape.join('x'),shape,values,'return X gelu_new',x=>x.map(gelu));
}
add('epsilon-scale-bias',[2,3],[1,1.001,1.002,-2,0,2],
 'option E .f32 shape 1 = array 0.01\noption S .f32 shape 3 = array -2.0 0.5 3.0\noption B .f32 shape 3 = array 0.1 -0.2 0.3\nreturn (X E layernorm) * S + B',
 x=>norm(x,3,Math.fround(.01)).map((v,i)=>v*[-2,.5,3][i%3]+Math.fround([.1,-.2,.3][i%3])));
const mlp='option W .f32 shape 3 4 = array shape 3 4\n0.5 -1.0 2.0 0.25\n-0.5 0.75 0.1 -2.0\n1.0 0.25 -0.5 0.75\nend\noption B .f32 shape 4 = array 0.1 -0.2 0.3 -0.4\noption V .f32 shape 4 2 = array shape 4 2\n1.0 -0.5\n0.25 0.75\n-0.1 0.5\n2.0 -1.0\nend\nH = ((X layernorm) W linear) + B\nH = H gelu_new\nreturn H V linear';
add('normalized-gelu-mlp',[2,3],[-1,.25,2,4,4.01,4.02],mlp,x=>{
 const n=norm(x,3,1e-5),w=[.5,-1,2,.25,-.5,.75,.1,-2,1,.25,-.5,.75].map(Math.fround),b=[.1,-.2,.3,-.4].map(Math.fround),v=[1,-.5,.25,.75,-.1,.5,2,-1].map(Math.fround);
 const out=[];
 for(let row=0;row<2;row++){
 const h=b.map((bias,j)=>gelu(bias+w.reduce((s,a,k)=>k%4===j?s+n[row*3+Math.floor(k/4)]*a:s,0)));
 for(let j=0;j<2;j++)out.push(h.reduce((s,a,k)=>s+a*v[k*2+j],0));
 }return out;
});
if(process.argv.includes('--android')){
 mkdirSync('output/playwright',{recursive:true});
 const script=readFileSync('packages/web/test/ram-norm.playwright.js','utf8')
    .replace('__RAM_FIXTURES__',JSON.stringify(fixtures));
 writeFileSync('output/playwright/ram-norm.js',script);
}else{
 const checks=[];
 try{
 for(const f of fixtures){
  const runtime=new Interpreter(()=>{},{
   loadModule:name=>({id:name,source:f.source}),
   ramGpu:(graph,input)=>{
    const loaded=sendRamGpu({action:'load',model:Buffer.from(graph.model).toString('base64')});
    assert.equal(loaded.fullyAccelerated,true,JSON.stringify(loaded));
    const result=sendRamGpu({action:'invoke',modelId:loaded.modelId,input,outputSize:f.expected.length});
    assert.equal(result.fullyAccelerated,true,JSON.stringify(result));
    return result.output;
   }});
  runtime.execute('use "norm.ram"');
  runtime.variables.set('X',{kind:'array',shape:f.shape,items:f.input});
  for(let repeat=0;repeat<2;repeat++){
   const actual=runtime.execute('X norm');
   assert.ok(isRankArray(actual));assert.deepEqual(actual.shape,f.outputShape);
   const errors=actual.items.map((v,i)=>Math.abs(v-f.expected[i]));
   errors.forEach((e,i)=>assert.ok(Number.isFinite(e)&&e<=f.tolerance+f.tolerance*Math.abs(f.expected[i]),f.stage+' cell '+i+': '+actual.items[i]+' != '+f.expected[i]));
   checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),tolerance:f.tolerance,fullyAccelerated:true});
  }runtime.dispose();
 }
 console.log(JSON.stringify({platform:process.platform,tolerance:{atol:1e-5,rtol:1e-5},checks},null,2));
 }finally{closeRamGpu();}
}
