import {readFileSync} from 'node:fs';
import {boundedRunAnswer} from './euler427-oracle.mjs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const file=process.argv[2]??'demos/euler/427_nsequences.ra',source=readFileSync(file,'utf8');
const cases=[...Array.from({length:25},(_,i)=>i),31,32,47,60,64,97,100];
let checked=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}])for(const n of cases) {
 const expected=boundedRunAnswer(n),runtime=new Interpreter(()=>{},{...options,args:[`--n=${n}`]});
 try{runtime.execute(source);if(runtime.variables.get('Answer')!==expected)throw Error(`n=${n} ${JSON.stringify(options)} mismatch ${runtime.variables.get('Answer')} != ${expected}`);checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({file,checked,cases,oracle:'bounded-run dynamic programming'}));
