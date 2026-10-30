import {pathToFileURL} from 'node:url';
const {Interpreter}=await import(pathToFileURL(process.env.RUNTIME ?? process.cwd()+'/packages/interpreter/out/index.js'));
import assert from 'node:assert/strict';
const base=`use sequences
use numbers
`;
const cases=[
 [`fun N f\n R = 0\n for J in 1 till N\n R += J f\n end\n return R\nend\nAnswer = 6 f`,0n],
 [`fun N f\n R = 1\n for J in 1 till N\n R += J f\n end\n return R\nend\nAnswer = 6 f`,32n],
 [`fun N f\n R = 0.0\n for J in 1 till N\n R += J f\n end\n return R\nend\nAnswer = 6 f`,0],
 [`fun N f\n R = 0\n for J in 1 till N\n R += J f\n end\n R = 1.5\n return R\nend\nAnswer = 6 f`,/R has type integer and cannot receive real/],
];
for(const [s,expected] of cases) for(const compilation of [false,true]){
 const r=new Interpreter(()=>{},{compilation});try{if(expected instanceof RegExp) assert.throws(()=>r.execute(base+s),expected);else{r.execute(base+s);assert.equal(r.variables.get('Answer'),expected);}}finally{r.dispose();}
}
console.log('8 recursive-return checks passed');
