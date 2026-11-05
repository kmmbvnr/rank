import {readFileSync} from 'node:fs';
export function sourceFor(variant='original'){
 if(variant==='delivered')return readFileSync(new URL('../../demos/euler/415_titanicsets.ra',import.meta.url),'utf8');
 if(['original','combined','scoped'].includes(variant))return readFileSync(new URL(`./euler415-${variant}.ra`,import.meta.url),'utf8');
 let source=sourceFor('original');
 if(variant==='prefix-copy')for(let j=0;j<3;j++)source=source.replace(`C${j} = (Cs (1 to Lm + 1)) mod Mod`,`C${j} = (Cs (1 to Lm + 1)) mod Mod copy`);
 else if(variant==='modscan')for(let j=0;j<3;j++)source=source.replace(`Cs = F${j} scan + with 0`,`Cs = (F${j} scan + with 0) mod Mod`).replace(`C${j} = (Cs (1 to Lm + 1)) mod Mod`,`C${j} = Cs (1 to Lm + 1) copy`);
 else throw Error('unknown Euler 415 variant');
 return source;
}
