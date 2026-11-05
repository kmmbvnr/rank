import {Interpreter,RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
for(const helper of [false,true]){
 const source=`fun X square Md
 return X * X mod Md
end
A = array 1 2 3
Total = 0
for I in 1 to 3
 B = ${helper?'A square 100000000':'A * A mod 100000000'}
 Total += B sum
end`;
 const runtime=new Interpreter(()=>{},{scalarEntryCompilation:false}),diagnostics=new RuntimeDiagnostics();
 try{diagnostics.run(()=>runtime.execute(source));const answer=String(runtime.variables.get('Total'));if(answer!=='42')throw Error('wrong answer');console.log(JSON.stringify({helper,answer,compiledLoops:diagnostics.compiledLoops,numberLoops:diagnostics.numberLoops}));}finally{runtime.dispose();}
}
