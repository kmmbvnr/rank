// Count strings with bounded run lengths, using color symmetry rather than
// factorials or inclusion-exclusion. Arithmetic stays exact modulo the target.
export function boundedRunAnswer(n, modulus=1000000009n) {
 if(n===0)return 0n;
 const colors=BigInt(n),different=colors-1n;
 let top=1n;for(let i=0;i<n;i++)top=top*colors%modulus;
 let answer=top; // Every nonempty string has longest run at least one.
 for(let cap=1;cap<n;cap++) {
  let counts=Array(cap+1).fill(0n);counts[1]=colors;
  for(let position=1;position<n;position++) {
   let total=0n;for(let run=1;run<=cap;run++)total=(total+counts[run])%modulus;
   const next=Array(cap+1).fill(0n);next[1]=different*total%modulus;
   for(let run=2;run<=cap;run++)next[run]=counts[run-1];
   counts=next;
  }
  let bounded=0n;for(let run=1;run<=cap;run++)bounded=(bounded+counts[run])%modulus;
  answer=(answer+top-bounded+modulus)%modulus;
 }
 return answer;
}
