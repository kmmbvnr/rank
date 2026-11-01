// Patch a disposable built runtime, never the working interpreter sources.
import {cpSync,mkdirSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),dest=resolve(process.argv[2]);
for(const pkg of ['language','interpreter']) {
 const out=resolve(dest,'packages',pkg);mkdirSync(out,{recursive:true});
 cpSync(resolve(root,'packages',pkg,'out'),resolve(out,'out'),{recursive:true});
 cpSync(resolve(root,'packages',pkg,'package.json'),resolve(out,'package.json'));
}
symlinkSync(resolve(root,'node_modules'),resolve(dest,'node_modules'),'dir');
const local=resolve(dest,'packages/interpreter/node_modules/@arrrank');mkdirSync(local,{recursive:true});
symlinkSync('../../../language',resolve(local,'language'),'dir');
const file=resolve(dest,'packages/interpreter/out/modules/bits.js'),source=readFileSync(file,'utf8');
const marker="let value = nonnegative('popcount', expectInteger(argument));";
if(!source.includes(marker)) throw Error('popcount implementation changed');
writeFileSync(file,source.replace(marker,marker+'\n        if (value <= 9007199254740991n) return BigInt(bitCount(Number(value)));'));
console.log(resolve(dest,'packages/interpreter/out/index.js'));
