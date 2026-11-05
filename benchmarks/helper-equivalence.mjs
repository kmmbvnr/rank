import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.argv[2]??fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics,parse}=await import(pathToFileURL(root+'/packages/interpreter/out/index.js'));
const cases=[
 ['return',"fun Input total\n Twice' = Input * 2\n return Twice sum\nend",'A total'],
 ['forward',"fun Input inner\n Twice' = Input * 2\n return Twice sum\nend\nfun Input total\n return Input inner\nend",'A total'],
 ['inline','','(A * 2) sum'],
 ['loop','fun Input total\n Value = 0\n for Cell in Input\n  Value += Cell * 2\n end\n return Value\nend','A total'],
 ['plan',"fun Input total\n Twice' = Input * 2\n Value = Twice sum\n return Value\nend",'A total'],
 ['chain',"fun Input inner\n Alias = Input\n Twice' = Alias * 2\n Value = Twice sum\n return Value\nend\nfun Input total\n return Input inner\nend",'A total'],
];
for(const [name,helpers,value]of cases){
 const runtime=new Interpreter(()=>{},{scalarEntryCompilation:false});
 const p=parse(`use sequences\n${helpers}\nA = array shape 4096 fill 1\nB = array shape 4096 fill 2\nfor R in 0 till 50\n B 0 = (${value}) mod 1000003\n unpack A B = tuple B A\nend`);
 try{
 for(let i=0;i<10;i++)runtime.executeProgram(p);
 const times=[];for(let i=0;i<7;i++){const t=performance.now();runtime.executeProgram(p);times.push(performance.now()-t);}
 const d=new RuntimeDiagnostics();d.run(()=>runtime.executeProgram(p));
 console.log(JSON.stringify({name,times,median:times.toSorted((a,b)=>a-b)[3],answer:String(runtime.execute('A 0')),numberLoops:d.numberLoops,overflows:d.numberLoopOverflows,probes:d.numberLoopCopyProbes,amortized:d.numberLoopCopyAmortized,borrows:d.numberFunctionArrayBorrows,costs:d.costs,fallbacks:d.fallbacks}));
 }finally{runtime.dispose();}
}
