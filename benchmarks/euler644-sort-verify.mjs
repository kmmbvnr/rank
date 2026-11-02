import {Interpreter,isRankArray} from '../packages/interpreter/out/index.js';
import {typedArray,readArrayItem} from '../packages/interpreter/out/array-storage.js';
const r=new Interpreter(()=>{});r.execute('use sequences');let checks=0;
for(const kind of ['real','integer'])for(const n of [0,1,2,3,8,17,80,3700])for(const axis of [0,1])for(const descending of [false,true]){
 const rows=4,shape=axis===1?[rows,n]:[n,rows];
 const cells=Array.from({length:rows*n},(_,i)=>((i*7919+13)%23)-11);
 r.variables.set('A',typedArray(kind==='real'?Float64Array.from(cells):Int32Array.from(cells),shape));
 const result=r.execute(`A argsort axis ${axis}${descending?' .descending':''}`);
 if(!isRankArray(result))throw Error('expected array');
 for(let row=0;row<rows;row++){
  const at=k=>axis===1?row*n+k:k*rows+row;
  const expected=Array.from({length:n},(_,i)=>i).sort((a,b)=>descending?cells[at(b)]-cells[at(a)]:cells[at(a)]-cells[at(b)]);
  for(let k=0;k<n;k++)if(readArrayItem(result,at(k))!==BigInt(expected[k]))throw Error(JSON.stringify({kind,n,axis,descending,row,k}));
 }
 checks++;
}
console.log(JSON.stringify({checks}));r.dispose();
