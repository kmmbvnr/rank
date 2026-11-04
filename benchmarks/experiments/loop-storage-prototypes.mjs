// Experimental built-JS variants. Production source is never edited.
import assert from 'node:assert/strict';
import {cpSync,readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';

function replace(s,a,b){assert(s.includes(a),`Missing prototype anchor: ${a.slice(0,100)}`);return s.replace(a,b);}
function edit(dir,file,operation){const p=resolve(dir,file);writeFileSync(p,operation(readFileSync(p,'utf8')));}
const pageSource=`
export class ReadCells {
 constructor(source) { this.source=source; this.length=source.length; }
 get(index) { return this.source[index]; }
}
export class PageCells {
 constructor(source,check,type,diagnostics) {
  this.source=source;this.length=source.length;this.pages=new Map();this.check=check;this.type=type;this.d=diagnostics;
 }
 get(index) { const page=this.pages.get(Math.floor(index/512));if(page)return page.values[index%512];const v=Number(this.source[index]);return this.type==='integer'?this.check(v):v; }
 set(index,value) {
  const n=Math.floor(index/512);let page=this.pages.get(n);
  if(!page){
   const first=n*512,count=Math.min(512,this.length-first),values=new Float64Array(count);
   for(let j=0;j<count;j++){const v=Number(this.source[first+j]);values[j]=this.type==='integer'?this.check(v):v;}
   page={values,dirty:new Uint8Array(count)};this.pages.set(n,page);
   if(this.d){this.d.experimentalPages=(this.d.experimentalPages??0)+1;this.d.experimentalPageCells=(this.d.experimentalPageCells??0)+count;}
  }
  page.values[index%512]=value;page.dirty[index%512]=1;
 }
 eachDirty(write){for(const [n,p] of this.pages)for(let j=0;j<p.dirty.length;j++)if(p.dirty[j])write(n*512+j,p.values[j]);}
}
`;
function pages(dir){
 writeFileSync(resolve(dir,'experimental-pages.js'),pageSource);
 edit(dir,'integer-loop-expressions.js',s=>replace(s,'const cell = `cells${info.slot}[${offset}]`;','const cell = `cells${info.slot}.get(${offset})`;'));
 edit(dir,'integer-loop-writes.js',s=>{
  s=replace(s,'{ code: `cells${target.slot}[${key}]`, type }','{ code: `cells${target.slot}.get(${key})`, type }');
  return replace(s,'`cells${target.slot}[${key}] = ${result}; changed${target.slot}[${key}] = 1; iterationResult = ${rhs}; iterationType = ${JSON.stringify(type)};`','`cells${target.slot}.set(${key}, ${result}); iterationResult = ${rhs}; iterationType = ${JSON.stringify(type)};`');
 });
 edit(dir,'number-loop-runtime.js',s=>{
  s=`import {ReadCells, PageCells} from './experimental-pages.js';\n`+s;
  s=replace(s,'if (host.observableEntry ||','if (plan.vectorIterations.length || host.observableEntry ||');
  s=replace(s,'const probe = conditionWriteCells > 64;','const probe = false; // Pages bound speculative copying by actual writes.');
  s=replace(s,'// A single indexed read-only pass', '// A single indexed read-only pass');
  const point='            // A single indexed read-only pass';
  // Keep all ordinary entry guards above this point; destination copying is lazy.
  const actual=s.indexOf('// A single indexed read-only pass');assert(actual>=0);
  s=s.slice(0,actual)+`if (plan.destinations.has(name)) {
                    buffers[info.slot]=new PageCells(info.type==='integer'?(integer32Cells(value)??items):items,safe,info.type??'integer',currentDiagnostics());
                    sources[info.slot]=value;input[info.slot]=value;continue;
                }
                `+s.slice(actual);
  s=replace(s,'            const diagnostics = currentDiagnostics();\n            if (diagnostics)\n                diagnostics.numberLoops++;',`            for(const [name,info] of storage)if(!plan.destinations.has(name))buffers[info.slot]=new ReadCells(buffers[info.slot]);
            const diagnostics = currentDiagnostics();
            if (diagnostics)
                diagnostics.numberLoops++;`);
  s=replace(s,'                    const dirty = changes[info.slot];',`                    const page= buffers[info.slot];
                    if(page instanceof PageCells){
                        if(!page.pages.size)continue;
                        const source=sources[info.slot], copy=arrayForWrite(source);
                        if(copy!==undefined)host.writer(name)(copy);
                        const write=prepareScalarArrayWriter(borrowArrayStorage(copy??source),true);
                        page.eachDirty((index,value)=>write(index,info.type==='boolean'?Boolean(value):info.type==='real'?value:BigInt(value)));
                        continue;
                    }
                    const dirty = changes[info.slot];`);
  return s;
 });
}
function transfer(dir,mode,chunk){
 edit(dir,'integer-loop.js',s=>{
  s=`import { privateLoopPolling } from './interrupt.js';\n`+s;
  s=replace(s,'numberVariant && !iteration && plan?.destinations.size','numberVariant && !iteration && plan');
  s=replace(s,'? { cells: 0, allow: true } : undefined;',`? { cells: 0, allow: true, transfer: !plan.hasControl && !plan.calls.length && !plan.vectorIterations.length && !plan.hasReturn && !plan.hasYield && !plan.arrayDefinitions.size && !plan.wideScalars.size && [...plan.localTypes.values()].every(t=>t==='integer'||t==='boolean') ? {active:false,paused:false,previous:undefined,mode:${JSON.stringify(mode)},numberBudget:${mode==='tierup'?'Infinity':chunk},exactBudget:512} : undefined } : undefined;`);
  s=replace(s,'    let mixed, preparedMixed = false;','    let mixed, preparedMixed = false;');
  const start=s.indexOf('    return { run: (...context) => {',s.indexOf('function compileTypedLoop'));
  const end=s.indexOf('\n}\n/** Shared region checks',start);assert(start>=0&&end>start);
  const original=s.slice(start,end).replace('    return { run:','    const ordinary = { run:');
  const extra=`
    const eligible=feedback?.transfer && exact && !plan.hasControl && !plan.calls.length && !plan.vectorIterations.length
      && !plan.hasReturn && !plan.hasYield && !plan.arrayDefinitions.size && !plan.wideScalars.size
      && [...plan.localTypes.values()].every(t=>t==='integer'||t==='boolean');
    return {run:(...context)=>{
      if(!eligible||!privateLoopPolling())return ordinary.run(...context);
      const t=feedback.transfer;let size=0;
      for(const [name] of plan.destinations){const a=host.read(name);if(!a||!isRankArray(a)||arrayRevision(a)===undefined||a.itemAt!==undefined)return ordinary.run(...context);size+=a.shape.reduce((x,y)=>x*y,1);}
      if(size>262144)return ordinary.run(...context);
      t.active=true;t.paused=false;t.previous=undefined;t.exactBudget=512;
      try{
        let result;
        if(t.mode!=='checkpoint'&&size>64){
          result=exact.run(...context);
          if(!result||!t.paused)return result;
        }
        for(;;){
          t.paused=false;
          result=fast.run(...context);
          if(!result){
            if(!preparedMixed){
              preparedMixed=true;
              const wide=wideLoopScalars(plan??numberPlan);
              const mixedPlan=wide.size&&lowerTypedLoop(statement,host,iteration,textSources,textArrays,()=>{},true,wide);
              mixed=mixedPlan?prepareNumberLoop(mixedPlan,host,feedback):undefined;
            }
            result=mixed?.run(...context);
            if(result){if(t.paused)continue;return result;}
            t.paused=false;t.exactBudget=Infinity;
            const d=currentDiagnostics();if(d)d.experimentalResumes=(d.experimentalResumes??0)+1;
            return exact.run(...context);
          }
          if(!t.paused)return result;
        }
      }finally{t.active=false;t.paused=false;t.previous=undefined;}
    }};
`;
  return s.slice(0,start)+original+extra+s.slice(end);
 });
 edit(dir,'integer-loop-runtime.js',s=>{
  s=replace(s,'    let countedRun;','    let countedRun, transferRun;');
  s=replace(s,'        if (feedback?.cells && privateLoopPolling() && !hasYield) {',`        if(feedback?.transfer?.active){
            transferRun??=compile(source
              .replace('let result = initialResult, location = -1;', 'const transfer = observeWork.transfer; let result = transfer.previous, location = -1, work = 0;')
              .split('checkpoint();').join('work++; checkpoint();')
              .replace('let iterationResult;', 'if(work>=transfer.exactBudget){transfer.previous=result;transfer.paused=true;return result;} let iterationResult;'),
              Object.assign(()=>{}, {transfer:feedback.transfer}));
            runner=transferRun;
            const d=currentDiagnostics();if(d)d.experimentalExactChunks=(d.experimentalExactChunks??0)+1;
        } else if (feedback?.cells && privateLoopPolling() && !hasYield) {`);
  return s;
 });
 edit(dir,'number-loop-runtime.js',s=>{
  s=replace(s,'    const source = `','    let source = `');
  s=replace(s,'    let run;',`    if(feedback?.transfer){
      source=source
       .replace("result, resultType = 'integer'", "result = transfer.active ? transfer.previous : undefined, resultType = transfer.active && typeof transfer.previous === 'boolean' ? 'boolean' : transfer.active && typeof transfer.previous === 'number' ? 'real' : 'integer'")
       .replace('const entered = [];', 'const entered = []; let transferSteps = 0;')
       .replace("let iterationResult, iterationType = 'integer';", "if(transfer.active && transferSteps++>=transfer.numberBudget){transfer.paused=true;break;} let iterationResult, iterationType = 'integer';");
    }
    let run;`);
  s=replace(s,"'widePower', code)","'widePower', 'transfer', code)");
  s=replace(s,'safeIntegerSquareRoot, divide, power, widePower);','safeIntegerSquareRoot, divide, power, widePower, feedback?.transfer);');
  s=replace(s,'const probe = conditionWriteCells > 64;','if(feedback?.transfer?.active && conditionWriteCells>262144)return recordFallback(\'number-loop:transfer-copy-budget\');\n            const probe = conditionWriteCells > 64 && !feedback?.transfer?.active;');
  s=replace(s,'            return completed(rankValue(result.value, result.type));',`            if(feedback?.transfer?.active){
                feedback.transfer.previous=rankValue(result.value,result.type);
                if(diagnostics)diagnostics.experimentalNumberChunks=(diagnostics.experimentalNumberChunks??0)+1;
            }
            return completed(rankValue(result.value, result.type));`);
  return s;
 });
}

function promotion(dir){
 writeFileSync(resolve(dir,'experimental-promotion.js'),`
import {RankError} from './errors.js';
import {currentDiagnostics} from './diagnostics.js';
const limit=9007199254740991n;
export function normalize(v){return typeof v==='bigint'&&v>=-limit&&v<=limit?Number(v):v;}
export function promote(op,a,b){
 if((op==='//'||op==='mod')&&(b===0||b===0n))throw new RankError('division by zero');
 if(typeof a==='number'&&typeof b==='number'){
  let v;
  if(op==='+')v=a+b;else if(op==='-')v=a-b;else if(op==='*')v=a*b;
  else if(op==='//'&&Math.abs(a)<4503599627370496)v=Math.floor(a/b)||0;
  else if(op==='mod'){v=a%b;if(v!==0&&(v<0)!==(b<0))v+=b;}
  if(Number.isSafeInteger(v))return v;
  const d=currentDiagnostics();if(d)d.experimentalPromotions=(d.experimentalPromotions??0)+1;
 }
 a=BigInt(a);b=BigInt(b);let v;
 if(op==='+')v=a+b;else if(op==='-')v=a-b;else if(op==='*')v=a*b;
 else if(op==='//'){v=a/b;if(a%b!==0n&&(a<0n)!==(b<0n))v--;}
 else if(op==='mod'){v=a%b;if(v!==0n&&(v<0n)!==(b<0n))v+=b;}
 else throw new Error('Unsupported promotion operation '+op);
 return normalize(v);
}
`);
 edit(dir,'integer-loop.js',s=>replace(s,
  'const numberPlan = numberVariant && lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => { }, true);',
  `const promoteEligible=plan&&!iteration&&!plan.arrays.size&&!plan.destinations.size&&!plan.calls.length&&!plan.builtins.size
    && !plan.hasControl&&!plan.hasReturn&&!plan.hasYield&&!plan.arrayDefinitions.size&&!plan.locations.some(isForStatement)
    && [...plan.localTypes.values()].every(t=>t==='integer'||t==='boolean')
    && !(plan.root.header+plan.root.setup+plan.body.join('')).includes('**');
   const numberPlan = numberVariant && lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => { }, promoteEligible?'promotion':true);`));
 edit(dir,'integer-loop-state.js',s=>replace(s,'host, numberMode, wideScalars,','host, numberMode, experimentalPromotion:numberMode===\'promotion\', wideScalars,'));
 edit(dir,'integer-loop-expressions.js',s=>replace(s,'const a = left.code, b = right.code, name = `v${state.serial++}`;',
  `const a = left.code, b = right.code, name = \`v\${state.serial++}\`;
   if(state.experimentalPromotion && type==='integer' && left.type==='integer'&&right.type==='integer'&&['+','-','*','//','mod'].includes(op)){
    lines.push(\`const \${name} = promote(\${JSON.stringify(op)}, \${a}, \${b});\`);return name;
   }`));
 edit(dir,'number-loop-runtime.js',s=>{
  s=`import {promote,normalize} from './experimental-promotion.js';\n`+s;
  s=replace(s,"'safe', 'int32',", "'safe', 'promote', 'int32',");
  s=replace(s, ')(safe, int32, overflow,', `)(body.join('').includes('promote(')?(v=>typeof v==='bigint'?normalize(v):safe(v)):safe, promote, int32, overflow,`);
  return s;
 });
}
export function prepare(root,out,chunk=8192){
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'package.json'),'{"type":"module"}\n');
 if(!existsSync(resolve(out,'node_modules')))symlinkSync(resolve(root,'node_modules'),resolve(out,'node_modules'));
 for(const v of ['current','pages','tierup','checkpoint','combined','promote']){
  const d=resolve(out,v);cpSync(resolve(root,'packages/interpreter/out'),d,{recursive:true});
  if(v==='pages')pages(d);
  else if(v==='promote')promotion(d);
  else if(v!=='current')transfer(d,v,chunk);
 }
}
