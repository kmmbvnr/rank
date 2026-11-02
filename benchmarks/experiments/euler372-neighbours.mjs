import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
const [id='373',mode='compiled'] = process.argv.slice(2);
const files={370:'triangles',373:'circles',374:'partproduct',375:'subseqmin',378:'triangles',379:'lcmcount',386:'antichain',388:'lines'};
const args={370:['--limit=10000000'],373:['--limit=10000'],374:['--limit=10000000'],
    375:['--limit=100000','--period=100000'],378:['--limit=100000'],379:['--limit=10000000'],
    386:['--limit=100000'],388:['--n=1000000','--cut=10000']}[id];
if(!args)throw Error('unknown case');
const source=readFileSync(new URL(`../../demos/euler/${id}_${files[id]}.ra`,import.meta.url),'utf8');
let calls=0;
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args,onScalarFunctionExecuted:()=>calls++});
const d=new RuntimeDiagnostics();
try {
    const start=performance.now(), run=()=>runtime.execute(source);
    if(process.env.DIAGNOSTICS)d.run(run);else run();
    console.log(JSON.stringify({id,mode,args,ms:performance.now()-start,answer:String(runtime.variables.get('Answer')),
        scalarCalls:calls,...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));
}finally{runtime.dispose();}
