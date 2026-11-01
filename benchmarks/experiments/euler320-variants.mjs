import {readFileSync} from 'node:fs';
export function sourceFor(variant='original'){
 if(variant==='production')return readFileSync(new URL('../../demos/euler/320_factorials.ra',import.meta.url),'utf8');
 const native=variant.endsWith('-native');
 if(native)variant=variant.slice(0,-7);
 const prune=variant.startsWith('prune');
 if(native&&!prune)throw Error('native sieve experiment requires pruning');
 if(prune)variant=variant==='prune'?'original':variant.slice(6);
 let source=readFileSync(new URL('./euler320-original.ra',import.meta.url),'utf8');
 if(variant==='cached')source=source.replace('  for (High valuation P) less Target\n    Have = High valuation P\n    High += (Target - Have) * (P - 1)\n  end','  Have = High valuation P\n  for Have less Target\n    High += (Target - Have) * (P - 1)\n    Have = High valuation P\n  end');
 else if(['greedy','inline'].includes(variant))source=source.slice(0,source.indexOf('fun P Target Prev minimum'))+readFileSync(new URL(`./euler320-${variant}-minimum.ra`,import.meta.url),'utf8')+'\n'+source.slice(source.indexOf('fun N valuation P'));
 else if(variant!=='original')throw Error('variant');
 if(prune)source=source.replace('Need = array shape (Upper + 1) fill 0\n','').replace('    Need P = P (Want P) (Need P) minimum\n    Best = Best max (Need P)','    if (Best valuation P) less (Want P)\n      Best = P (Want P) Best minimum\n    end');
 if(native)source=source.slice(0,source.indexOf('Spf ='))+'Spf = Upper factorsieve\n'+source.slice(source.indexOf('Want ='));
 return source;
}
