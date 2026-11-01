import {readFileSync} from 'node:fs';
export function sourceFor(variant='original'){
 if(variant==='production')return readFileSync(new URL('../../demos/euler/324_tower.ra',import.meta.url),'utf8');
 let source=readFileSync(new URL('./euler324-original.ra',import.meta.url),'utf8');
 const period=variant==='period'||variant==='period-convolve'||variant==='period-parity';
 const convolve=variant==='convolve'||variant==='period-convolve';
 const parity=variant==='parity'||variant==='period-parity';
 if(!['original','period','convolve','period-convolve','parity','period-parity'].includes(variant))throw Error('variant');
 if(period)source=source.replace('C = C copy','C = C copy\nPeriod = Mod * (Mod ** 2 - 1)\nPeriod *= (Mod ** 3 - 1)\nPeriod *= (Mod ** 5 - 1)\nPeriod //= (Mod - 1) ** 2').replace('  A = array shape K fill 0','  N = N mod Period\n  A = array shape K fill 0');
 if(parity)source=source.replace('if N odd','if N mod 2 equal 1');
 if(convolve)source=source.replace('  P = array shape (K * 2 - 1) fill 0\n  for I in 0 till K\n    for J in 0 till K\n      P (I + J) += A I * B J mod Mod\n    end\n  end','  P = (A convolve B) mod Mod');
 return source;
}
