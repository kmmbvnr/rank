import assert from 'node:assert/strict';
import {typedArray,readArrayItem} from '../packages/interpreter/out/array-storage.js';
import {scanInt32Axis} from '../packages/interpreter/out/axis-order.js';
let checks=0;
for(const value of[1,-1,2147483647,-2147483648])for(const n of[2**21+1,2**22+1]){
 const cells=new Int32Array(n).fill(value),array=typedArray(cells,[n]);
 const result=scanInt32Axis('+',array,[n],0);
 const last=BigInt(value)*BigInt(n);
 if(last>BigInt(Number.MAX_SAFE_INTEGER)||last<BigInt(Number.MIN_SAFE_INTEGER))assert.equal(result,undefined);
 else{assert.ok(result);for(const i of[0,1,2**21,n-1])assert.equal(readArrayItem(result,i),BigInt(value)*BigInt(i+1));}
 checks++;
}
console.log(JSON.stringify({checks,oracle:'positive/negative narrow/wide and unsafe long Int32 prefix, guarded compact scan'}));
