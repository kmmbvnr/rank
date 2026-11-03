import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const r=new Interpreter(); const d=new RuntimeDiagnostics();
r.execute('fun A B M residue\n  return A * B mod M\nend');
const cases=[];
const edge=[0n,1n,-1n,100000006n,-100000006n,9007199254740991n,-9007199254740991n,9007199254740993n,-9007199254740993n];
for(const a of edge)for(const b of edge)for(const m of [1n,100000007n,1073741824n,1073741825n,-7n,-100000007n])cases.push([a,b,m]);
let state=123456789n;
for(let i=0;i<500;i++){
 state=(state*6364136223846793005n+1442695040888963407n)&((1n<<64n)-1n);const a=state%9007199254740991n;
 state=(state*6364136223846793005n+1442695040888963407n)&((1n<<64n)-1n);const b=state%9007199254740991n;
 cases.push([i%2?-a:a,b,i%3?100000007n:1073741824n]);
}
const literal=x=>x<0n?`(${x})`:String(x);
try{
 d.run(()=>{for(const[a,b,m]of cases)assert.equal(r.execute(`${literal(a)} ${literal(b)} ${literal(m)} residue`),((a*b)%m+m)%m)});
 assert.throws(()=>r.execute('3 4 0 residue'),/division by zero/);
 console.log(JSON.stringify({checks:cases.length+1,numberFunctions:d.numberFunctions,numberFallbacks:d.numberFunctionFallbacks}));
}finally{r.dispose()}
