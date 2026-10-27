import { runCosts } from './costs.mjs';
import { sendRamGpu, closeRamGpu } from '../../packages/cli/out/ram-gpu.js';
import os from 'node:os';
const start=Date.now();
try {
    const result=runCosts(sendRamGpu,{progress:event=>process.stderr.write(JSON.stringify(event)+'\n'),
        memory:()=>({...process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024})});
    console.log(JSON.stringify({platform:process.platform,cpu:os.cpus()[0].model,node:process.version,
        elapsedMs:Date.now()-start,...result},null,2));
} finally {closeRamGpu();}
