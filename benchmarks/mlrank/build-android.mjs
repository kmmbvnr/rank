import { build } from 'vite';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
await build({configFile:false,logLevel:'silent',build:{outDir:'output/playwright/mlrank-costs',minify:false,
    lib:{entry:'benchmarks/mlrank/android-worker.mjs',formats:['iife'],name:'RankCosts',fileName:()=> 'worker.js'}}});
const code=readFileSync('output/playwright/mlrank-costs/worker.js','utf8');
const script=`async page => page.evaluate(code => new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);
    const timeout=setTimeout(()=>{worker.terminate();URL.revokeObjectURL(url);reject(Error('Benchmark timeout'));},240000);
    worker.onmessage=async ({data})=>{
        if(data.ram) await window.Capacitor.nativePromise('RamGpu','submit',data.ram);
        if(data.progress) console.log('RAM benchmark '+JSON.stringify(data.progress));
        if(data.result||data.error){clearTimeout(timeout);worker.terminate();URL.revokeObjectURL(url);data.error?reject(Error(data.error)):resolve(data.result);}
    };
    worker.onerror=error=>{clearTimeout(timeout);worker.terminate();URL.revokeObjectURL(url);reject(Error(error.message));};
    worker.postMessage({origin:location.origin});
}),${JSON.stringify(code)})`;
mkdirSync('output/playwright',{recursive:true});writeFileSync('output/playwright/ram-costs.js',script);
