import {readFileSync} from 'node:fs';
export function sourceFor(variant='original'){
 let source=readFileSync(new URL('./euler326-original.ra',import.meta.url),'utf8');
 if(['formula','keyed','keyed-plan','keyed-bound','accumulate','horner','weighted-formula','weighted-accumulate','discard-result','batched','flat-formula','row-formula'].includes(variant))source=source.slice(0,source.indexOf('fun N pairs M'))+readFileSync(new URL(`./euler326-${variant}.ra`,import.meta.url),'utf8');
 else if(variant!=='original')throw Error('variant');
 return source;
}
