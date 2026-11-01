// Expected hitting time from a decimal-prefix Markov chain, solved exactly.
// No sum over borders is used in this oracle.
export function markovWaiting(value) {
 const word=String(value);if(word.startsWith('-')) return 10n; // Existing helper's legacy domain.
 const length=word.length,m=Array.from({length},()=>Array(length+1).fill(0n));
 for(let state=0;state<length;state++) {
  m[state][state]=10n;m[state][length]=10n;
  for(let digit=0;digit<10;digit++) {
   const candidate=word.slice(0,state)+digit;let next=Math.min(length,candidate.length);
   while(next>0 && candidate.slice(-next)!==word.slice(0,next)) next--;
   if(next<length) m[state][next]-=1n;
  }
 }
 let previous=1n;
 for(let k=0;k<length-1;k++) {
  if(!m[k][k]) {
   const row=m.findIndex((r,i)=>i>k && r[k]);if(row<0) throw Error('singular chain');
   [m[k],m[row]]=[m[row],m[k]];
  }
  const pivot=m[k][k];
  for(let i=k+1;i<length;i++) {
   for(let j=k+1;j<=length;j++) {
    const numerator=m[i][j]*pivot-m[i][k]*m[k][j];
    if(numerator%previous) throw Error('nonexact elimination');m[i][j]=numerator/previous;
   }
   m[i][k]=0n;
  }
  previous=pivot;
 }
 const expected=Array(length).fill(0n);
 for(let i=length-1;i>=0;i--) {
  let numerator=m[i][length];for(let j=i+1;j<length;j++) numerator-=m[i][j]*expected[j];
  if(numerator%m[i][i]) throw Error('nonintegral state expectation');expected[i]=numerator/m[i][i];
 }
 return expected[0]-BigInt(length)+1n;
}

// Separate string implementation for large aggregates. The Markov solver above
// independently checks the border formula on the individual-pattern corpus.
const powers=[1n];for(let i=1;i<=128;i++) powers.push(powers[i-1]*10n);
export function stringWaiting(value) {
 if(value<0n) return 10n;
 const word=String(value);let result=powers[word.length]-BigInt(word.length)+1n;
 for(let k=1;k<word.length;k++) if(word.slice(0,k)===word.slice(-k)) result+=powers[k];
 return result;
}
export function sumWaiting(top,num) {
 let result=0n;for(let n=2;n<=top;n++) result+=stringWaiting(num/BigInt(n));return result;
}
