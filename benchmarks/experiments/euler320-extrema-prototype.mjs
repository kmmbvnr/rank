// Research control only: copy a built runtime and change one admission guard.
import {cpSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const [rootArg,targetArg]=process.argv.slice(2);
if(!rootArg||!targetArg)throw Error('built-root fresh-target');
const root=resolve(rootArg),target=resolve(targetArg);
if(root===target)throw Error('target must be an isolated directory');
mkdirSync(`${target}/packages/interpreter`,{recursive:true});
cpSync(`${root}/packages/interpreter/out`,`${target}/packages/interpreter/out`,{recursive:true});
symlinkSync(`${root}/node_modules`,`${target}/node_modules`);
if(existsSync(`${root}/packages/interpreter/node_modules`))symlinkSync(`${root}/packages/interpreter/node_modules`,`${target}/packages/interpreter/node_modules`);
const path=`${target}/packages/interpreter/out/jit/scalar-function-kernel.js`;
const source=readFileSync(path,'utf8'),old="!['len', 'floor', 'ceil'].includes(name)";
if(source.split(old).length!==2)throw Error('unexpected built guard');
writeFileSync(path,source.replace(old,"!['len', 'floor', 'ceil', 'min', 'max'].includes(name)"));
console.log(target);
