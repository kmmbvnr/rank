const root=process.env.RANK416_OUT??'/tmp/rank416-matmul-prototype/packages/interpreter/out/';
const {matmulValues}=await import(`${root}modules/linalg.js`);
const {ownedArray,readArrayItem}=await import(`${root}array-storage.js`);
let seed=416;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)%20001-10000;};
let checked=0;
for(const [rows,inner,columns]of [[13,19,17],[7,31,4],[5,32,5],[4,64,7],[2,257,9],[3,17,32]])for(const real of [false,true])for(let sample=0;sample<3;sample++){
 const a=Array.from({length:rows*inner},()=>real?random()/7:BigInt(random()));
 const b=Array.from({length:inner*columns},()=>real?random()/11:BigInt(random()));
 const actual=matmulValues(ownedArray(a,[rows,inner]),ownedArray(b,[inner,columns]));
 for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
  let expected=real?0:0n;for(let k=0;k<inner;k++)expected+=a[i*inner+k]*b[k*columns+j];
  if(readArrayItem(actual,i*columns+j)!==expected)throw Error(JSON.stringify({rows,inner,columns,real,sample,i,j}));
 }
 checked++;
}
console.log(JSON.stringify({checked,integerAndReal:true,quadRemainders:true,longContractions:true}));
