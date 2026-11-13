import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {euclidTotal} from './euler433-oracle.mjs';
const source=readFileSync('demos/euler/433_euclidsteps.ra','utf8');
const cases=[...Array.from({length:51},(_,i)=>i),63,64,80,81,99,100,121,200,300,499,1000];
let checked=0;
for(const options of [{},{numberLoopCompilation:false},{compilation:false}]){
 for(const n of cases){const runtime=new Interpreter(()=>{},{...options,args:[`--n=${n}`]});try{runtime.execute(source);const value=(runtime.variables.get('Answer') ?? runtime.lastResult),expected=euclidTotal(n);if(value!==expected)throw Error(`${n}: ${value} != ${expected}`);checked++;}finally{runtime.dispose();}}
 const fixtureId=new URL('../../demos/euler/433_euclidsteps_test.ra',import.meta.url).pathname;
 const fixture=new Interpreter(()=>{},{...options,sourceId:fixtureId,loadModule:specifier=>{const id=new URL(specifier+'.ra',new URL('../../demos/euler/',import.meta.url)).pathname;return{id,source:readFileSync(id,'utf8')};}});
 try{fixture.execute(readFileSync(fixtureId,'utf8'));if(fixture.testResults.length!==3||fixture.testResults.some(t=>!t.passed))throw Error(JSON.stringify(fixture.testResults));}finally{fixture.dispose();}
}
console.log(JSON.stringify({checked,fixtureTestsPerMode:3,modes:3,passed:true}));
