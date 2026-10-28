import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileRam,Interpreter} from '../packages/interpreter/out/index.js';
import {sendRamGpu,closeRamGpu,nodeRamGpu} from '../packages/cli/out/ram-gpu.js';

export async function checkKv(send, models) {
    const ensure=(ok,message)=>{if(!ok)throw Error(message);};
    const checks=[]; let maxError=0, retained=0, reused=0;
    const request=async r=>{const out=await send(r);if(out.error)throw Error(out.error);return out;};
    const load=async name=>(await request({action:'load',...models[name]})).modelId;
    const free=async id=>request({action:'releaseState',stateId:id});
    const read=async id=>(await request({action:'readState',stateId:id,outputSize:64})).output;
    const near=(actual,expected,label)=>{
        ensure(actual.length===expected.length,label+' shape');
        actual.forEach((v,i)=>{const error=Math.abs(v-expected[i]);maxError=Math.max(maxError,error);ensure(Number.isFinite(v)&&error<2e-5,label+' '+i+': '+v+' != '+expected[i]);});
        checks.push(label);
    };
    let writer=await load('kvwrite'), attention=await load('kvattention');
    const sequences=[{id:null,cache:Array(64).fill(0)},{id:null,cache:Array(64).fill(0)}];
    const q=[0.2,-0.3,0.4,0.7];
    for(let position=0;position<8;position++)for(let sequence=0;sequence<2;sequence++){
        const state=sequences[sequence],old=state.id,oldValues=[...state.cache];
        const row=Array.from({length:8},(_,i)=>Math.sin((position+1)*(i+1)+sequence));
        const slot=Array.from({length:8},(_,i)=>Number(i===position));
        const reply=await request({action:'invoke',modelId:writer,input:[...(old?[]:state.cache),...row,...slot],inputStates:[old,null,null],retainOutput:true,profile:true});
        ensure(!('output' in reply)&&reply.outputBytesRead===0,'retained output entered host');
        ensure(reply.state.shape.join() === '8,8'&&reply.state.dtype==='f32','state metadata');
        retained++;reused+=reply.stateInputsReused;state.id=reply.state.id;
        state.cache.splice(position*8,8,...row);
        if(old){near(await read(old),oldValues,'snapshot-'+sequence+'-'+position);await free(old);}
        // Model eviction/reload must not destroy retained sequence buffers.
        if(position===3&&sequence===1){
            await request({action:'release',modelId:writer});await request({action:'release',modelId:attention});
            for(let i=0;i<5;i++)await load('kvwrite');
            writer=await load('kvwrite');attention=await load('kvattention');
        }
        const mask=Array.from({length:8},(_,i)=>i<=position?0:-10000);
        const result=await request({action:'invoke',modelId:attention,input:[...q,...mask],inputStates:[null,state.id,null],profile:true});
        reused+=result.stateInputsReused;
        const scores=Array.from({length:position+1},(_,i)=>q.reduce((s,v,j)=>s+v*state.cache[i*8+j],0)*0.5);
        const weights=scores.map(v=>Math.exp(v-Math.max(...scores))),total=weights.reduce((a,b)=>a+b,0);
        near(result.output,Array.from({length:4},(_,j)=>weights.reduce((s,w,i)=>s+w/total*state.cache[i*8+4+j],0)),'attention-'+sequence+'-'+position);
        ensure(result.residentStates===2||position===0&&sequence===0,'state leak');
    }
    for(const state of sequences){
        near(await read(state.id),state.cache,'final-cache');
        await free(state.id);
        ensure((await send({action:'readState',stateId:state.id})).code==='STALE_STATE','released read succeeded');
        ensure((await send({action:'invoke',modelId:writer,input:Array(16).fill(0),inputStates:[state.id,null,null]})).code==='STALE_STATE','released reuse succeeded');
    }
    const final=await request({action:'release',modelId:writer});
    ensure(final.residentStates===0&&final.stateBytes===0,'states leaked');
    return {checks:checks.length,maxError,retainedOutputs:retained,stateInputsReused:reused,retainedReadbackBytes:0,independentSequences:2,positions:8,modelEviction:true,staleStatesRejected:true,finalStateBytes:final.stateBytes};
}

const modules=Object.fromEntries(['kvwrite','kvattention'].map(n=>[n+'.ram',readFileSync(new URL('../demos/mlrank/'+n+'.ram',import.meta.url),'utf8')]));
const models=Object.fromEntries(Object.entries(modules).map(([name,source])=>{
    const g=compileRam(source,name).graph;
    return [name.replace('.ram',''),{model:Buffer.from(g.model).toString('base64'),reservationBytes:g.reservationBytes,inputSizes:g.inputs.map(i=>i.shape.reduce((a,b)=>a*b,1)),inputDtypes:g.inputs.map(i=>i.dtype??'f32'),inputNames:g.nodes.flatMap((n,i)=>n.kind==='input'?['t'+i]:[]),outputName:'t'+g.output}];
}));
const source=readFileSync(new URL('../demos/mlrank/kv-cache.ra',import.meta.url),'utf8');
if(process.argv.includes('--fixture')){
    writeFileSync('/tmp/rank-mlrank/kv-fixture.json',JSON.stringify({models,modules,source,check:checkKv.toString()}));
}else{
    const runtime=new Interpreter(undefined,{ramGpu:nodeRamGpu,loadModule:n=>({id:n,source:modules[n]})});
    try{
        const report=await checkKv(sendRamGpu,models);
        assert.deepEqual(runtime.execute(source).items,[2,3,4,5]);
        report.rankDemo=true;
        console.log(JSON.stringify(report,null,2));
    }finally{runtime.dispose();closeRamGpu();}
}
