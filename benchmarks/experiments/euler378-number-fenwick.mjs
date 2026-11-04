// Experimental loader only: evaluate numeric Fenwick region performance.
// Production has its own transactional backend; leave those modules unchanged.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
const replace=(source,from,to)=>{if(source.includes(to))return source;assert(source.includes(from),from);return source.replace(from,to);};
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('.js')||!url.includes('/out/'))return result;
 let source=String(result.source);
 if(url.endsWith('/jit/integer-loop-writes.js')&&source.includes('lines.push(numberMode ?'))return result;
 if(url.endsWith('/jit/number-loop-runtime.js')&&source.includes("'./number-loop-fenwick.js'"))return result;
 if(url.endsWith('/runtime/fenwick.js')&&source.includes('numberSnapshot()'))return result;
 if(url.endsWith('/jit/integer-loop-expressions.js'))source=replace(source,'if (!numberMode && hasNativeFenwick(current)) {','if (hasNativeFenwick(current)) {');
 if(url.endsWith('/jit/integer-loop-writes.js'))source=replace(source,"if (!numberMode && host.arrayWrites && !assignment.name.includes('.') && hasNativeFenwick(host.read(assignment.name))) {","if (host.arrayWrites && !assignment.name.includes('.') && hasNativeFenwick(host.read(assignment.name))) {");
 if(url.endsWith('/jit/integer-loop-writes.js'))source=replace(source,'lines.push(`checkValueMutable(${receiver});`);','lines.push(numberMode ? `${receiver}.checkMutable();` : `checkValueMutable(${receiver});`);');
 if(url.endsWith('/jit/number-loop-runtime.js')){
  source="import {hasNativeFenwick, PrivateNumberFenwick} from '../runtime/fenwick.js';\n"+source;
  source=replace(source,"some(info => info.kind !== 'index')","some(info => info.kind !== 'index' && info.kind !== 'fenwick')");
  source=replace(source,'if (!value || !isRankIndex(value) || !hasPrivateIndexStorage(value))',`
            if(info.kind === 'fenwick') {
                if(!hasNativeFenwick(value)) return undefined;
                let privateValue=indices.get(value);
                if(!privateValue) {
                    try {privateValue=new PrivateNumberFenwick(value,overflow);}
                    catch(error) {if(error===overflow)return undefined;throw error;}
                    indices.set(value,privateValue);
                }
                input[info.slot]=privateValue;
                continue;
            }
            if (!value || !isRankIndex(value) || !hasPrivateIndexStorage(value))`);
 }
 if(url.endsWith('/runtime/fenwick.js'))source+=`
export class PrivateNumberFenwick {
 constructor(source,overflow){
  this.source=source;this.overflow=overflow;
  this.values=new Float64Array(source.size);this.tree=new Float64Array(source.size+1);
  for(let i=0;i<source.size;i++){
   const n=Number(source.at(BigInt(i)));
   if(!Number.isSafeInteger(n))throw overflow;
   this.values[i]=n;this.tree[i+1]=n;
  }
  for(let i=1;i<this.tree.length;i++){
   const parent=i+(i&-i);
   if(parent<this.tree.length){const n=this.tree[parent]+this.tree[i];if(!Number.isSafeInteger(n))throw overflow;this.tree[parent]=n;}
  }
  if(!this.tree.every(Number.isSafeInteger))throw overflow;
 }
 checkMutable(){checkValueMutable(this.source);}
 position(index){
  const i=Number(index);
  if(!Number.isSafeInteger(i)||i<0||i>=this.values.length)throw new MissingValueError('fenwick index out of bounds: '+index);
  return i;
 }
 at(index){const n=this.values[this.position(index)];return typeof index==='bigint'?BigInt(n):n;}
 sum(index){
  let total=0;
  if(index!==-1&&index!==-1n)for(let i=this.position(index)+1;i>0;i-=i&-i){total+=this.tree[i];if(!Number.isSafeInteger(total))throw this.overflow;}
  return typeof index==='bigint'?BigInt(total):total;
 }
 set(index,value){
  checkValueMutable(this.source);
  const i=this.position(index),n=Number(value);
  if(!Number.isSafeInteger(n))throw this.overflow;
  const delta=n-this.values[i];if(!Number.isSafeInteger(delta))throw this.overflow;
  this.values[i]=n;
  for(let at=i+1;at<this.tree.length;at+=at&-at){const v=this.tree[at]+delta;if(!Number.isSafeInteger(v))throw this.overflow;this.tree[at]=v;}
 }
 publish(){for(let i=0;i<this.values.length;i++){const n=BigInt(this.values[i]);if(this.source.at(BigInt(i))!==n)this.source.set(BigInt(i),n);}}
 rollback(){}
}
`;
 return {...result,source};
}});
await import('../euler378-investigation.mjs');
