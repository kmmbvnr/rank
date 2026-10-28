import { Interpreter, parse, compileRam, encodeRamWeights, createRamClient, isRankArray } from '../../packages/interpreter/out/index.js';

const cases = [[4,2,3,2], [256,2,3,2], [1,64,128,32], [16,64,128,32], [16,128,256,64]];
const now = () => performance.now();
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const array = (shape,items) => ({kind:'array',shape,items});
const base64 = bytes => { let text=''; for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(text); };
function fixture([batch,width,hidden,output]) {
    const values = (n,seed,scale=1) => Array.from({length:n},(_,i)=>Math.fround((((i*17+seed*13)%101)-50)/50*scale));
    const shapes=[[width,hidden],[hidden],[hidden,output],[output]];
    const weights = width===2 ? [[1,1,-1,1,1,1],[0,-1,0],[-4,4,8,-8,1,1],[2,-2]]
        : [values(width*hidden,1,1/Math.sqrt(width)),values(hidden,2,.1),values(hidden*output,3,1/Math.sqrt(hidden)),values(output,4,.1)];
    const names=['W1','B1','W2','B2'];
    const files=Object.fromEntries(names.map((name,i)=>[name.toLowerCase()+'.rwt',encodeRamWeights(shapes[i],weights[i])]));
    const source=`use ml\narg X .f32 shape ${batch} ${width}\n`+names.map((name,i)=>
        `option ${name} .f32 shape ${shapes[i].join(' ')} = "${name.toLowerCase()}.rwt"`).join('\n')+
        '\nHidden = ((X W1 linear) + B1) relu\nLogits = (Hidden W2 linear) + B2\nreturn Logits softmax';
    const inputs = [values(batch*width,5),values(batch*width,7)];
    return {batch,width,hidden,output,shapes,weights,names,files,source,inputs};
}
function reference(f,input) {
    const result=[];
    for(let row=0;row<f.batch;row++) {
        const h=Array.from({length:f.hidden},(_,j)=>{
            let x=f.weights[1][j];for(let k=0;k<f.width;k++) x+=input[row*f.width+k]*f.weights[0][k*f.hidden+j];return Math.max(0,x);
        });
        const logits=Array.from({length:f.output},(_,j)=>{
            let x=f.weights[3][j];for(let k=0;k<f.hidden;k++) x+=h[k]*f.weights[2][k*f.output+j];return x;
        });
        const max=Math.max(...logits), exp=logits.map(x=>Math.exp(x-max)), sum=exp.reduce((a,b)=>a+b,0);
        result.push(...exp.map(x=>x/sum));
    }
    return result;
}
function check(actual,expected,shape) {
    if(!isRankArray(actual)||String(actual.shape)!==String(shape)) throw Error('Incorrect result shape');
    let maxError=0;
    actual.items.forEach((x,i)=>{
        const error=Math.abs(x-expected[i]);
        if(!Number.isFinite(error)||error>1e-5+1e-5*Math.abs(expected[i])) throw Error('Numerical mismatch at '+i+': '+x+' expected '+expected[i]);
        maxError=Math.max(maxError,error);
    });
    return maxError;
}
/** Uses the same interpreter and synchronous native transport on every host.
 * CPU weights/setup and parsing are outside repeated-call timings, on both paths. */
export function runCosts(send,{samples=15,warmup=3,progress=()=>{},memory=()=>undefined,selected=cases}={}) {
    const results=[];
    for(const dimensions of selected) {
        progress({phase:'start',dimensions});
        const f=fixture(dimensions), expected=f.inputs.map(input=>reference(f,input));
        const before=memory();
        let started=now(); const graph=compileRam(f.source,'classifier.ram',name=>f.files[name]).graph;
        const compileMs=now()-started;
        const compileSamples=[];
        for(let i=0;i<3;i++){started=now();compileRam(f.source,'classifier.ram',name=>f.files[name]);compileSamples.push(now()-started);}
        let traces=[], profiling=true;
        const client=createRamClient(request=>{
            const profiled=profiling ? {...request,profile:true} : request, start=now();
            const reply=send(profiled), wallMs=now()-start;
            if(profiling && request.action==='invoke' && !reply.error) {
                const parts=['inputMs','dispatchMs','readbackMs','outputMs'].map(name=>reply[name]);
                if(parts.some(x=>!Number.isFinite(x)||x<0)||parts.reduce((a,b)=>a+b,0)>reply.executeMs+.01)
                    throw Error('Invalid native timing breakdown');
            }
            if(request.action!=='release') traces.push({request:profiled,reply,wallMs});
            return reply;
        });
        const gpu=new Interpreter(()=>{}, {loadModule:id=>({id,source:f.source,readBinary:name=>f.files[name]}),
            ramGpu:(graph,input)=>client.invoke(graph,()=>base64(graph.model),input,f.batch*f.output).output});
        const cpu=new Interpreter(()=>{});
        f.names.forEach((name,i)=>cpu.variables.set(name,array(f.shapes[i],f.weights[i])));
        started=now();
        cpu.execute('use linalg\nuse ml\nuse numbers\nfun Row probabilities rank 1\nE = (Row - (Row max)) exp\nreturn E / (E sum)\nend\n');
        const cpuSetupMs=now()-started;
        started=now();gpu.execute('use "classifier.ram"');const gpuImportMs=now()-started;
        const programs=[parse('Hidden = ((X matmul W1) + B1) relu\nLogits = (Hidden matmul W2) + B2\nLogits probabilities'),parse('X classifier')], runtimes=[cpu,gpu];
        const inputs=f.inputs.map(items=>array([f.batch,f.width],items));
        let maxError=0;
        const invoke=(kind,index)=>{
            const runtime=runtimes[kind];runtime.variables.set('X',inputs[index]);traces=[];
            const start=now(), value=runtime.executeProgram(programs[kind]), wallMs=now()-start;
            // Materialization is part of the cost, even if a future CPU operation becomes lazy.
            const materializeStart=now(); const materialized={...value,items:[...value.items]};
            const materializeMs=now()-materializeStart;
            maxError=Math.max(maxError,check(materialized,expected[index],[f.batch,f.output]));
            const trace=traces.map(({request,reply,wallMs})=>({action:request.action,wallMs,
                requestBytes:new TextEncoder().encode(JSON.stringify(request)).length,
                prepareMs:reply.prepareMs,executeMs:reply.executeMs,inputMs:reply.inputMs,
                dispatchMs:reply.dispatchMs,readbackMs:reply.readbackMs,outputMs:reply.outputMs,
                peakRssBytes:reply.peakRssBytes}));
            return {wallMs:wallMs+materializeMs,materializeMs,trace};
        };
        try {
            const coldCpu=invoke(0,0),coldGpu=invoke(1,0);
            for(let i=0;i<warmup;i++){invoke(0,i%2);invoke(1,i%2);}
            const cpuSamples=[],gpuSamples=[];
            for(let i=0;i<samples;i++) {
                // Alternate order and input to reduce cache/order bias.
                if(i%2){gpuSamples.push(invoke(1,i%2));cpuSamples.push(invoke(0,i%2));}
                else {cpuSamples.push(invoke(0,i%2));gpuSamples.push(invoke(1,i%2));}
            }
            profiling=false;
            const unprofiledGpuSamples=Array.from({length:samples},(_,i)=>invoke(1,i%2));
            results.push({dimensions,compileMs,compileSamples,cpuSetupMs,gpuImportMs,
                modelBytes:graph.model.length,sourceWeightBytes:Object.values(f.files).reduce((n,b)=>n+b.length,0),
                inputBytes:f.batch*f.width*4,outputBytes:f.batch*f.output*4,coldCpu,coldGpu,cpuSamples,gpuSamples,unprofiledGpuSamples,
                unprofiledGpuMedianMs:median(unprofiledGpuSamples.map(s=>s.wallMs)),
                cpuMedianMs:median(cpuSamples.map(s=>s.wallMs)),gpuMedianMs:median(gpuSamples.map(s=>s.wallMs)),maxError,
                memoryBefore:before,memoryAfter:memory()});
            progress({phase:'done',dimensions,cpuMedianMs:results.at(-1).cpuMedianMs,gpuMedianMs:results.at(-1).gpuMedianMs});
        } finally {client.release();cpu.dispose();gpu.dispose();}
    }
    return {samples,warmup,results};
}
