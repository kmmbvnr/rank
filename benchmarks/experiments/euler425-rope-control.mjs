import { pathToFileURL } from 'node:url';
const root = process.env.RANK425_RUNTIME_ROOT;
const runtime = file => root ? pathToFileURL(root + file)
    : new URL('../../packages/interpreter/out/' + file, import.meta.url);
const {rope}=await import(runtime('rope.js'));
const {typedArray}=await import(runtime('array-storage.js'));
const data=new BigInt64Array(1000000);
for(let i=0;i<data.length;i++) data[i]=BigInt(i)*BigInt(i)+10000000000000n;
const source=typedArray(data), start=performance.now(), tree=rope(source);
if(tree.plan.at(1234n)!==data[1234])throw Error('value mismatch');
console.log(JSON.stringify({ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
