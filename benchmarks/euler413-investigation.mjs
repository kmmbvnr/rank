import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK413_RUNTIME??new URL('../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',digits='19',variant='original']=process.argv.slice(2);
let src=readFileSync(new URL(variant==='delivered'?'../demos/euler/413_onechild.ra':'./experiments/euler413-original.ra',import.meta.url),'utf8');
if(variant==='select-first')src=src.replace('      Add = A less 2 choose Up 0', '      A = A Ix\n      Rk = Rk Ix\n      LayPart = Lay Ix\n      Z = Z Ix\n      Add = A less 2 choose Up 0').replace('Nw = (Rk + Add) * 2 + Lay + Z','Nw = (Rk + Add) * 2 + LayPart + Z').replace('concat Nk (Nw Ix)','concat Nk Nw');
if(variant.startsWith('lookup')){
const table=`  Half = N // 2
  Rest = N - Half
  Split = 3 ** Half
  Fast = N gcd 10 equal 1
  LowMap = array 0
  HighMap = array 0
  if Fast
    Low = 0 till Split
    High = 0 till 3 ** (N - N // 2)
    Weights = 3 ** (10 * (0 till N) mod N)
    Lower = Pw (0 till N // 2)
    Upper = Pw (0 till N - N // 2)
    Ld = Low reshape 1 (Low len)
    Ld = Ld // (Lower reshape Half 1) mod 3
    Hd = High reshape 1 (High len)
    Hd = Hd // (Upper reshape Rest 1) mod 3
    Lt = Weights (0 till N // 2)
    Ht = Weights (N // 2 till N)
    LowMap = Lt matmul Ld copy
    HighMap = Ht matmul Hd copy
  end
`;
src=src.replace('  Keys = array 0',table+'  Keys = array 0');
const begin=src.indexOf('    Pr = Pk reshape');const end=src.indexOf('    Nk = array',begin);
const old=src.slice(begin,end).trimEnd().split('\n').map(l=>'  '+l).join('\n');
src=src.slice(0,begin)+`    Bk = array 0
    if Fast
      Bk = LowMap (Pk mod Split)
      Bk += HighMap (Pk // Split)
    else
`+old+'\n    end\n'+src.slice(end);
}
if(variant.includes('final')){
const begin=src.indexOf('      Add = A less');const end=src.indexOf('    end\n    Od =',begin);
src=src.slice(0,begin)+`      if Pos equal N - 1
        Final = Lay + Z equal 1
        Tot += Final choose Cnt 0 sum
      else
`+src.slice(begin,end).trimEnd().split('\n').map(l=>'  '+l).join('\n')+'\n      end\n'+src.slice(end);
const group=src.indexOf('    Od =');const stop=src.indexOf('  end\n  One =',group);
src=src.slice(0,group)+'    if Pos less N - 1\n'+src.slice(group,stop).trimEnd().split('\n').map(l=>'  '+l).join('\n')+'\n    end\n'+src.slice(stop);
src=src.replace('  One = Keys mod 2 equal 1\n  Tot += One choose Cnt 0 sum\n','');
}
if(variant.includes('lazy'))src=src.replace('    Dg = Pr // (Pw reshape N 1)\n    Dg = Dg mod 3 copy',"    Raw' = Pr // (Pw reshape N 1)\n    Dg = Raw mod 3 copy");
if(variant==='lazy-select')src=src.replace('      Z = Rk mod 3\n      if S equal 0\n        Z += 1\n      end',`      Extra = 0
      if S equal 0
        Extra = 1
      end
      Z = Rk mod 3 + Extra`).replace('      A = Rk // Up mod 3',"      A' = Rk // Up mod 3").replace('      Add = A less 2 choose Up 0',"      Add' = A less 2 choose Up 0").replace('      Nw = (Rk + Add) * 2 + Lay + Z',"      Nw' = (Rk + Add) * 2 + Lay + Z");
if(process.env.RANK413_SOURCE){writeFileSync(process.env.RANK413_SOURCE,src);process.exit(0);}
const start=performance.now(),cpu=process.cpuUsage();
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--digits=${digits}`]});
const d=new RuntimeDiagnostics();
try{d.run(()=>r.execute(src));const c=process.cpuUsage(cpu);console.log(JSON.stringify({mode,digits,variant,ms:performance.now()-start,cpuMs:(c.user+c.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),d}));}finally{r.dispose();}
