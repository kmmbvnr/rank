import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const original=readFileSync(new URL('./euler412-original.ra',import.meta.url),'utf8');
const native=original.replace(/fun V modprod P[\s\S]*?\nend/,`fun V modprod P
  return V reduce * with 1 mod P
end`).replace(/Fc = array shape \(2 \* M\) fill 1[\s\S]*?\nend/,`Fc = 1 to 2 * M - 1
Fc = Fc scan * with 1 mod P`);
function oracle(m,k){let cells=m*m-k*k,f=1n,h=1n;for(let i=1;i<=cells;i++)f*=BigInt(i);const w=m-k;for(let y=0;y<m;y++)for(let x=0;x<(y<w?m:w);x++){let down=0;for(let j=y+1;j<m;j++)if(x<(j<w?m:w))down++;h*=BigInt((y<w?m:w)-x+down);}return f/h%76543217n;}
const direct=native.replace('Fact = 1\nfor Lo in 1 to Cells by Chunk', `Tail = Cells greater (P - 1) // 2
if Cells at least P
  Tail = false
end
Start = 1
Last = Cells
if Tail
  Start = Cells + 1
  Last = P - 1
end
Fact = 1
for Lo in Start to Last by Chunk`).replace('Hi = Cells min (Lo + Chunk - 1)','Hi = Last min (Lo + Chunk - 1)').replace('Part = (Lo to Hi) mod P copy', "Part' = Lo to Hi").replace('\nFc = ',`\nif Tail
  Fact = P - Fact (P - 2) P powmod
end
Fc = `);
const delivered=readFileSync(new URL('../../demos/euler/412_gnomonnumbering.ra',import.meta.url),'utf8');
let checked=0;
for(const compilation of [false,true])for(let m=1;m<=12;m++)for(let k=0;k<m;k++)for(const src of [original,native,direct,delivered]){
 const r=new Interpreter(()=>{},{compilation,args:[`--m=${m}`,`--k=${k}`,'--chunk=7']});
 try{r.execute(src);const got=r.variables.get('Answer'),want=oracle(m,k);if(got!==want)throw Error(`${compilation} ${m} ${k} ${got} != ${want}`);checked++;}finally{r.dispose();}
}
console.log(JSON.stringify({checked}));
