import {describe,expect,it} from 'vitest';
import {safetensor} from '../src/safetensors.js';
import {fileTensorInput} from '../src/file-tensor.js';
import {verifyFile} from '../src/file-integrity.js';
import {isRankArray,type RankFile} from '../src/value.js';

describe('fresh combined file status',()=>{
    function fixture(){
        const header=new TextEncoder().encode(JSON.stringify({x:{dtype:'F32',shape:[1],data_offsets:[0,4]}}));
        const bytes=new Uint8Array(8+header.length+4),view=new DataView(bytes.buffer);
        view.setBigUint64(0,BigInt(header.length),true);bytes.set(header,8);view.setFloat32(8+header.length,3,true);
        let cursor=0,revision='first',stats=0,size=bytes.length;
        const file:RankFile={kind:'file',closed:false,handle:{name:'weights.safetensors',
            stat:()=>{stats++;return {size,revision};},
            size:()=>{throw Error('Separate size query');},revision:()=>{throw Error('Separate revision query');},
            nativePath:()=> 'weights.safetensors',sha256:()=> 'a'.repeat(64),
            position:()=>cursor,seek:n=>{cursor=n;},read:n=>{const b=bytes.slice(cursor,cursor+n);cursor+=b.length;return b;},
            write:()=>{},flush:()=>{},close:()=>{},
        }};
        return {file,stats:()=>stats,change:()=>{revision='second';},resize:()=>{size++;}};
    }
    it('shares one fresh observation between integrity and tensor metadata checks',()=>{
        const f=fixture();verifyFile(f.file,'a'.repeat(64));safetensor(f.file,'x');
        const before=f.stats(),tensor=safetensor(f.file,'x');
        expect(f.stats()-before).toBe(1);
        if(!isRankArray(tensor))throw Error('Expected array');
        const descriptor=fileTensorInput(tensor);
        expect(descriptor?.revision).toBe('first');expect(f.stats()-before).toBe(2);
        f.change();
        expect(()=>fileTensorInput(tensor)).toThrow(/changed/);
        expect(()=>tensor.items).toThrow(/changed/);
        expect(()=>safetensor(f.file,'x')).toThrow(/changed/);
    });
    it.each(['resize','change'] as const)('rejects %s without a verified digest too',action=>{
        const f=fixture(),tensor=safetensor(f.file,'x');
        if(!isRankArray(tensor))throw Error('Expected array');
        f[action]();expect(()=>fileTensorInput(tensor)).toThrow(/changed/);
    });
    it('does not use a previous status after close',()=>{
        const f=fixture(),tensor=safetensor(f.file,'x');
        if(!isRankArray(tensor))throw Error('Expected array');
        f.file.closed=true;expect(()=>fileTensorInput(tensor)).toThrow(/closed/i);
    });
});
