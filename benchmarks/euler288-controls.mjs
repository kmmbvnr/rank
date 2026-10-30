import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
const [file,mode='compiled']=process.argv.slice(2);
const r=new Interpreter(()=>{},{compilation:mode==='compiled'});const t=performance.now();
try {r.execute(readFileSync(file,'utf8'));const answer=String(r.variables.get('Answer'));const expected=file.includes('129_')?'1000023':file.includes('104_')?'329468':file.includes('288_')?'605857431263981935':undefined;if(expected)assert.equal(answer,expected);console.log(JSON.stringify({file,mode,ms:performance.now()-t,answer,rssMiB:process.resourceUsage().maxRSS/1024}));}finally{r.dispose();}
