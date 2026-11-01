import {readFileSync} from 'node:fs';
export function sourceFor(variant='original') {
let source=readFileSync(new URL('./euler319-original.ra',import.meta.url),'utf8');
const views=variant==='views' || variant==='array-sieve-views';
if(variant==='views')variant='scan';
if(variant==='array-sieve-views')variant='array-sieve';
const incremental=variant==='incremental';
if(incremental)variant='scan';
const vector=variant==='vector' || variant==='array-sieve-vector';
if(variant==='vector')variant='scan';
if(variant==='array-sieve-vector')variant='array-sieve';
const hyperbola=variant.endsWith('-hyperbola') || variant==='hyperbola';
if(variant.endsWith('-hyperbola'))variant=variant.slice(0,-10);
if(variant==='hyperbola')variant='scan';
if(['array-sieve','spf-sieve','packed-sieve'].includes(variant)) {
 const sieve=readFileSync(new URL(`./euler319-${variant}.ra`,import.meta.url),'utf8');
 source=source.replace('use numbers','use numbers\nuse sequences\nuse algo');
 source=source.slice(0,source.indexOf('Mu ='))+sieve+source.slice(source.indexOf('rem Dependencies'));
}
else if(variant==='primes') source=source.replace('use numbers','use numbers\nuse sequences').replace('Pr = array shape PrimeSize fill 0','Pr = primes to Limit array').replace('    Pr Cnt = I\n','').replace('for I in 1 to Limit\n  Mu I += Mu (I - 1)\nend','Mu = Mu scan + array');
else if(variant==='scan') source=source.replace('for I in 1 to Limit\n  Mu I += Mu (I - 1)\nend','Mu = Mu scan + array');
else if(variant==='prefix') source=source.replace('for I in 1 to Limit\n  Mu I += Mu (I - 1)\nend','for I in 0 to Limit\n  if I greater 0\n    Mu I += Mu (I - 1)\n  end\nend');
else if(variant==='whole') {
 const end=source.indexOf('Answer print');
 source=source.slice(0,source.indexOf('Mod ='))+'1 solve print\n'+source.slice(end+'Answer print'.length)+'\nfun Dummy solve\n'+source.slice(source.indexOf('Mod ='),end)+'return Answer\nend\n';
} else if(variant!=='original') throw Error('variant');
if(hyperbola) source=source.slice(0,source.indexOf('for Slot in Top'))+readFileSync(new URL('./euler319-hyperbola-cache.ra',import.meta.url),'utf8')+source.slice(source.indexOf('Answer = 1'));
if(vector) source=source.slice(0,source.indexOf('for Slot in Top'))+readFileSync(new URL('./euler319-vector-cache.ra',import.meta.url),'utf8')+source.slice(source.indexOf('Answer = 1'));
if(incremental)source=source.replace('Before = 0\nL = 1','Before = 0\nRoot = N isqrt\nP2 = 1\nP3 = 1\nL = 1').replace('  Current = R coeff','  Current = 0\n  if R at most Root\n    P2 = P2 * 2 mod Mod\n    P3 = P3 * 3 mod Mod\n    Current = (Before + P3 - P2 - 1) mod Mod\n  else\n    Current = R coeff\n  end');
if(views) source=source.slice(0,source.indexOf('for Slot in Top'))+readFileSync(new URL('./euler319-views-cache.ra',import.meta.url),'utf8')+source.slice(source.indexOf('Answer = 1'));
return source;
}
