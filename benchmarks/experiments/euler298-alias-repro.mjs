import {Interpreter,RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
const source=`A = array 1 2 3
Total = 0
for I in 0 to 2
  B = A
  for J in 0 to 2
    B J += 1
  end
  Total += B 0
end
Answer = A 0
`;
for(const compilation of [false,true]){const runtime=new Interpreter(()=>{},{compilation}),d=new RuntimeDiagnostics();try{d.run(()=>runtime.execute(source));console.log(JSON.stringify({compilation,answer:String(runtime.variables.get('Answer')),total:String(runtime.variables.get('Total')),diagnostics:d}));}finally{runtime.dispose();}}
