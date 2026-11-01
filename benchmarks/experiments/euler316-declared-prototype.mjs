// Disposable research runtime. This is not a reviewed production call lowering.
import {cpSync,mkdirSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),dest=resolve(process.argv[2]);
for(const pkg of ['interpreter','language']) {
 const out=resolve(dest,'packages',pkg);mkdirSync(out,{recursive:true});
 cpSync(resolve(root,'packages',pkg,'out'),resolve(out,'out'),{recursive:true});
 cpSync(resolve(root,'packages',pkg,'package.json'),resolve(out,'package.json'));
}
symlinkSync(resolve(root,'node_modules'),resolve(dest,'node_modules'),'dir');
const local=resolve(dest,'packages/interpreter/node_modules/@arrrank');mkdirSync(local,{recursive:true});
symlinkSync('../../../language',resolve(local,'language'),'dir');
const proofFile=resolve(dest,'packages/interpreter/out/jit/scalar-function-proof.js');
let source=readFileSync(proofFile,'utf8').replace('isApplicationExpression,','isApplicationExpression, isDeclaredCallExpression,');
const read='read: source => {';if(!source.includes(read))throw Error('proof source changed');
source=source.replace(read,read+`
 if (isDeclaredCallExpression(source) && !source.ranks.length && !source.axes.length && isNameExpression(source.callee)
     && source.dataParameters.length === source.arguments.length) {
  const definition = lexicalBinding(scope, source.callee.name)?.function;
  const signature = definition && functionCallSignature(definition);
  if (!signature || signature.words.length || signature.parameters.some(p => p.deferred || p.kind === 'function')) return undefined;
  return userCall([...source.arguments, source.callee], env, source);
 }
`);writeFileSync(proofFile,source);
const loopFile=resolve(dest,'packages/interpreter/out/jit/integer-loop-expressions.js');
source=readFileSync(loopFile,'utf8').replace('isApplicationExpression,','isApplicationExpression, isDeclaredCallExpression,');
const emit='function emitInput(e, lines, hint, tail = false) {';if(!source.includes(emit))throw Error('loop source changed');
source=source.replace(emit,emit+`
 if (isDeclaredCallExpression(e) && !e.ranks.length && !e.axes.length && isNameExpression(e.callee)
     && e.dataParameters.length === e.arguments.length) {
  return emitInput(applicationExpression([...e.arguments, e.callee]), lines, hint, tail);
 }
`);writeFileSync(loopFile,source);
console.log(resolve(dest,'packages/interpreter/out/index.js'));
