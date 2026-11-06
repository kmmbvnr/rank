import {Interpreter,RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
for(const reverse of [false,true]){
 const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
 try{diagnostics.run(()=>runtime.execute(`use sequences
Total = 0
for P in ${reverse?'(primes from 3 to 200) reverse':'primes from 3 to 200'}
 Total += P
end`));
 console.log(JSON.stringify({reverse,answer:String(runtime.variables.get('Total')),compiledLoops:diagnostics.compiledLoops,numberLoops:diagnostics.numberLoops,fallbacks:diagnostics.fallbacks}));
 }finally{runtime.dispose();}
}
