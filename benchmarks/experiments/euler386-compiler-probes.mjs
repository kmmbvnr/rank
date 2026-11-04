import assert from 'node:assert/strict';
import {Interpreter, RuntimeDiagnostics} from '../../packages/interpreter/out/index.js';
const cases={
 'array-index':`fun Es pick Pos\n return Es Pos\nend\nValues = array 7 11\nAnswer = Values pick 1`,
 'array-iteration':`fun Es total\n Total = 0\n for E in Es\n  Total += E\n end\n return Total\nend\nValues = array 7 11\nAnswer = Values total`,
 'local-concat':`fun Es size E\n Next = concat Es (array E)\n return Next len\nend\nValues = array 7 11\nAnswer = Values size 13`,
 'bounded-sequence-length':`Sieve = 100 primesieve\nfun Top tally\n return (Sieve to Top) len\nend\nAnswer = 50 tally`,
 'recursive-array-extension':`fun Es tally N\n if N equal 0\n  return Es len\n end\n More = concat Es (array N)\n M = N - 1\n return More tally M\nend\nValues = array 7 11\nAnswer = Values tally 3`,
};
for(const[name,body]of Object.entries(cases)){
 let expected;
 for(const compilation of[false,true]){
  const d=new RuntimeDiagnostics();let calls=0;
  const r=new Interpreter(()=>{},{compilation,onScalarFunctionExecuted:()=>calls++});
  try{
   d.run(()=>r.execute('use numbers\nuse sequences\n'+body));
   const answer=String(r.variables.get('Answer'));
   if(!compilation)expected=answer;else assert.equal(answer,expected);
   console.log(JSON.stringify({name,compilation,answer,calls,rejections:d.compilerRejections,fallbacks:d.fallbacks}));
  }finally{r.dispose();}
 }
}
