const{Interpreter:Runtime}=await import(process.env.RANK350_RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [m='10007',n='1000000']=process.argv.slice(2);const t=performance.now();const r=new Runtime(()=>{},{scalarFunctionCompilation:false});
try{r.execute(`M = ${m}\nR = 0\nfor I in 1 to ${n}\n R = (R + I) * 99991 mod M\nend`);console.log(JSON.stringify({m,n,ms:performance.now()-t,result:String(r.variables.get('R')),rssMiB:process.resourceUsage().maxRSS/1024}));}finally{r.dispose()}
