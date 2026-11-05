import {readFileSync} from 'node:fs';
const original=readFileSync(new URL('./euler414-original.ra',import.meta.url),'utf8');
export function source(variant='original'){
 let s=original;
 if(['four','combined'].includes(variant)){
  const begin=s.indexOf('          if Cy greater 0'),end=s.indexOf('          Ci = Cx * B + Cy',begin);
  s=s.slice(0,begin)+`          Low = (B - Cx) min Cx
          High = (B - Cx) max Cx
          if Cy greater 0
            Left = B - 1 - Cy
            Right = Cy - 1
            Small = Left min Right
            Large = Left max Right
            Cx = B - 1 - (Low min Small)
            Mid = Low max Small
            Mid = Mid min (High min Large)
            Cy = (High max Large) - Mid
          else
            Left = B - Cx
            Right = Cx - 1
            Cx = B - 1 - (Left min Right)
            Cy = B - 1 - (Left max Right)
          end
`+s.slice(end);
  for(const name of ['X0','X1','X2','X3','X4','T'])s=s.replace(`  ${name} = 0\n`,'');
 }
 if(['triangle','triangle-fresh','combined'].includes(variant))s=s.replace('  Dd = ((0 to B * B - 1) * 0) copy',`  Size = B * (B + 1) // 2
  Dd = ${variant==='triangle-fresh'?'array shape Size fill 0':'(0 till Size) * 0 copy'}`).replace('Cu * B + Cv','Cu * (Cu + 1) // 2 + Cv').replace('U * B + V','U * (U + 1) // 2 + V').replace('Cx * B + Cy','Cx * (Cx + 1) // 2 + Cy');
 if(variant==='no-mod')s=s.replace('Sm = (Sm + Wt) mod Mod','Sm += Wt');
 return s;
}
