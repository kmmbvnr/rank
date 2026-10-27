// Export identical FP32 inputs and RAM graphs for a native-runtime comparison.
import {writeFileSync} from 'node:fs';
import {compileRam} from '../../packages/interpreter/out/index.js';
import {ramModel} from '../../packages/interpreter/out/ram-model.js';
const size=s=>s.reduce((a,b)=>a*b,1);
const values=(s,seed=0)=>Array.from({length:size(s)},(_,i)=>Math.fround(Math.sin(i*.37+seed)*.5));
const fixtures=[];
const add=(name,recipe,inputs,body,extra={})=>{
 const source='use ml\n'+inputs.map((x,i)=>'option '+['X','Y'][i]+' .f32 shape '+x.shape.join(' ')).join('\n')+'\n'+body;
 const start=performance.now(),g=compileRam(source,'compare.ram').graph,compileMs=performance.now()-start;
 const f={name,recipe,inputs,source,compileMs,nodes:g.nodes,output:g.output,outputShape:g.outputShape,model:Buffer.from(g.model).toString('base64'),...extra};
 if(recipe==='matmul') f.implicitModel=Buffer.from(ramModel([{kind:'input',shape:inputs[0].shape},{kind:'input',shape:inputs[1].shape},{kind:'matmul',left:0,right:1,shape:g.outputShape}],2)).toString('base64');
 fixtures.push(f);
};
for(const [name,shape,items]of [
 ['norm-offset',[3,7],Array.from({length:21},(_,i)=>1000+(i%7)*.125)],
 ['norm-constant',[3,7],Array(21).fill(1000.25)],
 ['norm-wide',[16,768],values([16,768])],
]) add(name,'layernorm',[{shape,items}],'return X layernorm');
add('gelu-wide','gelu',[{shape:[16,768],items:values([16,768]).map(x=>x*10)}],'return X gelu_new');
for(const [name,a,b]of [
 ['matmul-crossed-batches',[2,1,3,5],[1,3,5,7]],
 ['matmul-heads-small',[1,4,16,16],[1,4,16,16]],
 ['matmul-heads-large',[1,4,64,64],[1,4,64,64]],
 ['matmul-throughput',[1,8,256,256],[1,8,256,256]],
]) add(name,'matmul',[{shape:a,items:values(a)},{shape:b,items:values(b,2)}],'return X matmul Y rank 2 2');
const shape=[1,16,64],weightShape=[64,192],weights=values(weightShape,3);
const body='option W .f32 shape 64 192 = array shape 64 192\n'+weights.join(' ')+'\nend\nP = X W linear\nQ = (P # # (0 till 64)) reshape 1 16 4 16\nK = (P # # (64 till 128)) reshape 1 16 4 16\nQ = Q transpose axis 0 2 1 3\nK = K transpose axis 0 2 3 1\nreturn Q matmul K rank 2 2';
add('qkv-heads-qkt','qkv',[{shape,items:values(shape)}],body,{weights,weightShape});
writeFileSync(process.argv[2]??'/tmp/rank-mlrank/coreml-fixtures.json',JSON.stringify(fixtures));
