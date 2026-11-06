import {Interpreter,RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
const cases=[
 ['pointwise',`A = array 1 2 3
Total = 0
for K in 1 to 3
 B = A * 2 copy
 Total += B sum
end`,'36'],
 ['scan',`A = array 1 2 3
Total = 0
for K in 1 to 3
 B = A scan + with 0 copy
 Total += B sum
end`,'30'],
 ['direct-gather',`A = array 10 20 30 40
I = array 0 1
Total = 0
for K in 1 to 2
 Total += (A I) sum
end`,'60'],
 ['helper-gather',`fun A gathered I
 return (A I) sum
end
A = array 10 20 30 40
I = array 0 1
Total = 0
for K in 1 to 2
 Total += A gathered I
end`,'60'],
];
for(const [kind,body,expected]of cases){
 const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
 try{diagnostics.run(()=>runtime.execute('use sequences\n'+body));const answer=String(runtime.variables.get('Total'));if(answer!==expected)throw Error(kind);console.log(JSON.stringify({kind,answer,numberLoops:diagnostics.numberLoops,numberFunctions:diagnostics.numberFunctions,compiledLoops:diagnostics.compiledLoops,fallbacks:diagnostics.fallbacks}));}finally{runtime.dispose();}
}
