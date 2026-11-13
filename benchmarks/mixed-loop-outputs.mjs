// Fresh-process control used after the 397 delivery build.
import {readFileSync} from 'node:fs';
import {Interpreter,formatValue} from '../packages/interpreter/out/index.js';
const [file,...args]=process.argv.slice(2);
const r=new Interpreter(()=>{},{args});
const start=performance.now();
try {
    r.execute(readFileSync(file,'utf8'));
    console.log(JSON.stringify({file,args,ms:performance.now()-start,
        rssMiB:process.resourceUsage().maxRSS/1024,answer:formatValue((r.variables.get('Answer') ?? r.lastResult))}));
} finally {r.dispose();}
