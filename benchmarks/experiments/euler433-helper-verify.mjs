import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {chainTotal} from './euler433-oracle.mjs';
const source=readFileSync('benchmarks/experiments/euler433-helper-probe.ra','utf8');
let checked=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]){
 const runtime=new Interpreter(()=>{},options);
 try{runtime.execute(source.slice(0,source.indexOf('Limit = N // 5')));const fn=runtime.variables.get('chains');for(let q=0;q<=200;q++){if(fn.call([BigInt(q)])!==chainTotal(q))throw Error('chain '+q);checked++;}}
 finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,passed:true}));
