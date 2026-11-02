import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
if(process.env.CONTROL==='borrow')registerHooks({load(url,context,next){
    const result=next(url,context);
    if(!url.endsWith('/jit/scalar-function-kernel.js'))return result;
    const source=String(result.source),needle='parameterTypes.every(t => isNumType(t) || arrayParameter(t))';
    assert(source.includes(needle));
    return {...result,source:source.replace(needle,'parameterTypes.every(t => isNumType(t))')};
}});
const {Interpreter,RuntimeDiagnostics}=await import('../packages/interpreter/out/index.js');
const {typedArray}=await import('../packages/interpreter/out/array-storage.js');
const [kind='int32',length='1000000',repeats='20']=process.argv.slice(2);
const n=Number(length),count=Number(repeats);
assert(Number.isSafeInteger(n)&&n>0&&Number.isSafeInteger(count)&&count>0);
const data=kind==='int32'?new Int32Array(n):new BigInt64Array(n);
let sum=0n;
for(let i=0;i<n;i++){const value=i%997-498;data[i]=kind==='int32'?value:BigInt(value);sum+=BigInt(value);}
const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
try {
    runtime.execute(`fun A weighted N
  Total = 0
  for I in 0 till A len
    Total += A I * N
  end
  return Total
end`);
    runtime.variables.set('A',typedArray(data,[n]));
    const run=()=>{for(let i=0;i<count;i++)assert.equal(runtime.execute('A weighted 17'),sum*17n);};
    const start=performance.now();
    if(process.env.DIAGNOSTICS)diagnostics.run(run);else run();
    console.log(JSON.stringify({kind,n,count,control:process.env.CONTROL||'',ms:performance.now()-start,
        rssMiB:process.resourceUsage().maxRSS/1024,answer:String(sum*17n),...(process.env.DIAGNOSTICS?{diagnostics}:{})}));
}finally{runtime.dispose();}
