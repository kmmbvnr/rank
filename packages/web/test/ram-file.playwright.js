async page => {
    const fixture = __FILE_FIXTURE__;
    return page.evaluate(async fixture => {
        const send = async request => {
            const id = crypto.randomUUID();
            await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});
            return fetch('/__rank_ml_result?id='+id).then(r=>r.json());
        };
        const modelFile = {...fixture.modelFile,path:'filecheck.tflite'};
        const loaded = await send({action:'load',modelFile});
        if(loaded.error) throw Error(loaded.error);
        let maxError=0;
        for(let i=0;i<3;i++) {
            const result=await send({action:'invoke',modelId:loaded.modelId,input:fixture.input,profile:true});
            if(result.error) throw Error(result.error);
            result.output.forEach((v,j)=>{const e=Math.abs(v-fixture.expected[j]);maxError=Math.max(maxError,e);if(!Number.isFinite(e)||e>1e-5+1e-5*Math.abs(fixture.expected[j])) throw Error('Wrong output');});
        }
        const bad=await send({action:'load',modelFile:{...modelFile,sha256:'0'.repeat(64)}});
        if(!bad.error?.includes('checksum')) throw Error('Checksum mismatch accepted');
        const wrong=await send({action:'load',modelFile:{...modelFile,size:modelFile.size+1}});
        if(!wrong.error?.includes('size mismatch')) throw Error('Size mismatch accepted');
        const stat=await fetch('/__rank_model_file?name=large.safetensors&action=stat').then(r=>r.json());
        if(stat.size!==2147483899) throw Error('Wrong large file size');
        const data=await fetch('/__rank_model_file?name=large.safetensors&offset=2147483875&count=24').then(r=>r.arrayBuffer());
        const values=Array.from(new Float32Array(data));
        if(JSON.stringify(values)!=='[1,-2,3,4,5,6]') throw Error('Wrong range beyond 2 GiB');
        const traversal=await fetch('/__rank_model_file?name=../large.safetensors&action=stat');
        if(traversal.ok) throw Error('Path traversal accepted');
        return {gpuCalls:3,maxError,descriptorBytes:JSON.stringify(modelFile).length,checksumRejected:true,sizeMismatchRejected:true,
            largeFileBytes:stat.size,rangeBeyond2GiB:values,pathTraversalRejected:true};
    },fixture);
}
