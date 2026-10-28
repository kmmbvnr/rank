// Seal a local Hugging Face Safetensors index; shard payloads stay on disk.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {nodeIo} from '../packages/cli/out/node-io.js';
import {parseCheckpointManifest} from '../packages/interpreter/out/checkpoint.js';
import {safetensorIndex} from '../packages/interpreter/out/safetensors.js';
const [input,output]=process.argv.slice(2).map(p=>resolve(p));
if(!input||!output||dirname(input)!==dirname(output)||!output.endsWith('.safetensors.index.json'))
    throw Error('Usage: node scripts/mlrank-lock-checkpoint.mjs INPUT.index.json OUTPUT.safetensors.index.json (same directory; new output file)');
if(statSync(input).size>16*1024*1024)throw Error('Index exceeds 16 MiB');
const bytes=readFileSync(input),text=bytes.toString('utf8'),manifest=parseCheckpointManifest(text);
const files=Object.create(null);
for(const name of new Set(Object.values(manifest.weight_map))){
    const handle=nodeIo.open(join(dirname(input),name),'read');
    try{
        const revision=handle.revision(),size=handle.size();
        const entries=safetensorIndex({kind:'file',closed:false,handle}).items;
        const actual=new Set(entries.map(row=>row.entries.get('name')));
        const wanted=Object.keys(manifest.weight_map).filter(key=>manifest.weight_map[key]===name);
        if(actual.size!==wanted.length||wanted.some(key=>!actual.has(key)))throw Error('Shard tensor names differ from weight_map: '+name);
        const sha256=handle.sha256();
        if(revision!==handle.revision())throw Error('Shard changed during import: '+name);
        if(manifest.files&&(manifest.files[name].size!==size||manifest.files[name].sha256!==sha256))throw Error('Existing shard integrity mismatch: '+name);
        files[name]={size,sha256};
    }finally{handle.close();}
}
const sealed=JSON.stringify({...JSON.parse(text),files},null,2)+'\n';
if(Buffer.byteLength(sealed)>16*1024*1024)throw Error('Locked index exceeds 16 MiB');
writeFileSync(output,sealed,{flag:'wx'});
console.log(JSON.stringify({path:output,sha256:createHash('sha256').update(sealed).digest('hex'),shards:Object.keys(files).length,tensors:Object.keys(manifest.weight_map).length},null,2));
