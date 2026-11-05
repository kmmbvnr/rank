// Research-only loader: fuse a proved range into modular reduce.
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const r=next(url,context);if(!url.endsWith('/out/reduction.js') || process.env.RANK412_STREAM==='0')return r;
let s=String(r.source);
s=`import {stepOf as probeStep} from './runtime/modular-fold.js';\nimport {checkpoint as probeCheck} from './interrupt.js';\n`+s;
s=s.replace('const residues = bounds ?',`if (bounds && kind === 'reduce' && axis === undefined && modulus >= 1n && modulus <= 2147483648n && bounds.count >= 0n && bounds.count <= 2147483648n && (bounds.count > 0n || seed !== undefined)) {
 const m=Number(modulus), count=Number(bounds.count), step=probeStep(operator,m);
 let r=Number((bounds.start%modulus+modulus)%modulus), stride=Number((bounds.step%modulus+modulus)%modulus);
 let acc=seed===undefined?r:Number((seed%modulus+modulus)%modulus);
 probeCheck('reducing',count);
 for(let i=0;i<count;i++){
  if(seed!==undefined || i>0)acc=step(acc,r);
  const n=r+stride;r=n>=m?n-m:n;
 }
 return BigInt(acc);
}
const residues = bounds ?`);
return {...r,source:s};}});
