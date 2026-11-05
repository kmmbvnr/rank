import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/jit/integer-loop-expressions.js'))return result;let source=String(result.source);
if(source.includes('fusedProduct'))throw Error('Historical Euler 408 prototype requires research base fbc76219');
source=source.replace("if (isBinaryExpression(e) && !e.step && ['+'",`if(isBinaryExpression(e)&&e.operator==='mod'){
 let product=unwrap(e.left);
 if(isBinaryExpression(product)&&product.operator==='*')return {name:'mod-product',operands:[product.left,product.right,e.right].map(unwrap)};
 }
 if (isBinaryExpression(e) && !e.step && ['+'`);
source=source.replace("const type = point.name === 'choose'", "const type = point.name === 'mod-product' ? types.every(type=>type==='integer') ? 'integer' : undefined : point.name === 'choose'");
return {...result,source};}});
