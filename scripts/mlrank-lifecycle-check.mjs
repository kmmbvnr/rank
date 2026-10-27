import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, createRamClient, encodeRamWeights } from '../packages/interpreter/out/index.js';
import { sendRamGpu, closeRamGpu } from '../packages/cli/out/ram-gpu.js';
const source = readFileSync('demos/mlrank/classifier.ram','utf8');
const weights = Object.fromEntries(['w1','b1','w2','b2'].map(n=>[n+'.rwt',readFileSync('demos/mlrank/'+n+'.rwt')]));
const events=[]; let handle;
const client=createRamClient(request=>{
    const reply=sendRamGpu(request);
    events.push({action:request.action,modelBytes:request.model?Buffer.from(request.model,'base64').length:0,code:reply.code});
    if(reply.modelId) handle=reply.modelId;
    return reply;
});
const interpreter=new Interpreter(()=>{}, {
    loadModule:id=>({id,source,readBinary:name=>weights[name]}),
    ramGpu:(graph,input)=>client.invoke(graph,()=>Buffer.from(graph.model).toString('base64'),input,8).output,
});
try {
    interpreter.execute('use "classifier.ram"\nX = array shape 4 2\n0.0 0.0\n0.0 1.0\n1.0 0.0\n1.0 1.0\nend');
    const first=interpreter.execute('X classifier').items;
    assert.deepEqual(interpreter.execute('X classifier').items,first);
    assert.deepEqual(events.map(e=>e.action),['load','invoke','invoke']);
    sendRamGpu({action:'release',modelId:handle});
    assert.deepEqual(interpreter.execute('X classifier').items,first);
    assert.equal(events.at(-3).code,'STALE_MODEL');
    closeRamGpu();
    assert.deepEqual(interpreter.execute('X classifier').items,first);
    assert.equal(events.at(-3).code,'STALE_MODEL');
    weights['b2.rwt']=encodeRamWeights([2],[-2,2]);
    const changed=interpreter.execute('X classifier').items;
    assert.ok(Math.abs(changed[0]-first[1])<1e-6);
    assert.notDeepEqual(changed,first);
    client.release();
    assert.equal(sendRamGpu({action:'invoke',modelId:handle,input:Array(8).fill(0)}).code,'STALE_MODEL');
    console.log(JSON.stringify({events,first,changed}));
} finally {interpreter.dispose();closeRamGpu();}
