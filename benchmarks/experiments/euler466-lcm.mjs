import { resolve } from 'node:path';
if(!process.argv[2])throw Error('Usage: BUILD_ROOT small|wide');
const root=resolve(process.argv[2]),kind=process.argv[3]??'small';
if(!['small','wide'].includes(kind))throw Error('Expected small or wide');
const {Interpreter,RuntimeDiagnostics}=await import(root+'/packages/interpreter/out/index.js');
const {typedArray}=await import(root+'/packages/interpreter/out/array-storage.js');
const n=100000,cells=kind==='small'?Int32Array.from({length:n},(_,i)=>i%1000+1):BigInt64Array.from({length:n},(_,i)=>9007199254740993n+BigInt(i));
const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
runtime.execute('use numbers\nuse sequences');runtime.variables.set('Values',typedArray(cells));
const source='Products = Values lcm 37\nAnswer = Products sum';
for(let i=0;i<2;i++)runtime.execute(source);
const times=[];
for(let i=0;i<5;i++){const start=performance.now();diagnostics.run(()=>runtime.execute(source));times.push(performance.now()-start);}
let expected=0n;
for(const cell of cells){const value=BigInt(cell);let a=value,b=37n;while(b)[a,b]=[b,a%b];expected+=value/a*37n;}
if(runtime.variables.get('Answer')!==expected)throw Error('Incorrect LCM checksum');
console.log(JSON.stringify({kind,n,times,answer:String(runtime.variables.get('Answer')),diagnostics}));runtime.dispose();
