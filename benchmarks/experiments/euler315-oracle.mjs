// Explicit lit segment names, independent of Rank's numeric masks and overlap DP.
// Euler's 7 has four segments: a,b,c,f (including the top-left segment).
const segments=['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abcf','abcdefg','abcdfg'];
function display(digits) {
 const lit=new Set();
 for(let i=digits.length-1,place=0;i>=0;i--,place++) for(const segment of segments[Number(digits[i])]) {
  lit.add(place*7+segment.charCodeAt(0)-97);
 }
 return lit;
}
export function clockDifference(value) {
 let digits=String(value);if(digits.startsWith('-')) return 0;
 let previous=new Set(),sam=0,max=0;
 for(;;) {
  const current=display(digits);sam+=2*current.size;
  for(const led of previous) if(!current.has(led)) max++;
  for(const led of current) if(!previous.has(led)) max++;
  previous=current;
  if(digits.length===1) break;
  let next=0;for(const c of digits) next+=c.charCodeAt(0)-48;
  digits=String(next);
 }
 max+=previous.size;return sam-max;
}
export function primeRange(from,to) {
 const composite=new Uint8Array(Math.max(to,2)),primes=[];
 for(let p=2;p*p<to;p++) if(!composite[p]) for(let n=p*p;n<to;n+=p) composite[n]=1;
 for(let n=Math.max(2,from);n<to;n++) if(!composite[n]) primes.push(n);
 return {count:primes.length,answer:primes.reduce((sum,n)=>sum+clockDifference(n),0)};
}
