import { describe, it, expect } from 'vitest';
import { createRamClient, type RamRequest } from '../src/ram-client.js';

describe('RAM model lifecycle', () => {
    it('sends only a file descriptor on load and no source on repeated invoke', () => {
        const requests: RamRequest[] = [];
        const descriptor = { path: '/models/block.tflite', size: 3 * 1024 ** 3, sha256: 'a'.repeat(64) };
        const client = createRamClient(request => {
            requests.push(request);
            return request.action === 'load' ? { modelId: 'file', fullyAccelerated: true }
                : { output: [1], fullyAccelerated: true };
        });
        client.invoke('file', () => descriptor, [1], 1);
        client.invoke('file', () => { throw Error('must not resend'); }, [1], 1);
        expect(requests[0].modelFile).toEqual(descriptor);
        expect(requests[0].model).toBeUndefined();
        expect(JSON.stringify(requests[0]).length).toBeLessThan(256);
        expect(requests.slice(1).every(r => !r.modelFile && !r.model)).toBe(true);
    });
    it('loads once, replaces, releases and reloads stale handles without model in invoke', () => {
        const requests: RamRequest[] = []; let resident: string | undefined, sequence = 0;
        const client = createRamClient(request => {
            requests.push(request);
            if (request.action === 'load') return { modelId: resident = String(++sequence), fullyAccelerated: true };
            if (request.action === 'release') { resident = undefined; return {}; }
            expect(request.model).toBeUndefined();
            return request.modelId === resident ? { output: [3], fullyAccelerated: true }
                : { error: 'expired', code: 'STALE_MODEL' };
        });
        const key = {}, encode = () => 'model';
        expect(client.invoke(key, encode, [1], 1).cached).toBe(false);
        expect(client.invoke(key, encode, [2], 1).cached).toBe(true);
        resident = undefined;
        expect(client.invoke(key, encode, [2], 1).output).toEqual([3]);
        client.invoke({}, encode, [2], 1);
        client.release();
        client.invoke(key, encode, [2], 1);
        expect(requests.filter(r => r.action === 'load')).toHaveLength(4);
    });
    it('keeps file inputs out of inline data, including stale-handle recovery', () => {
        const requests: RamRequest[] = []; let stale = true;
        const file = { path: '/models/weights.safetensors', revision: 'version', fileSize: 3 * 1024 ** 3,
            offset: 2 ** 31 + 64, length: 4, dtype: 'F32', shape: [1] };
        const client = createRamClient(request => {
            requests.push(request);
            if (request.action === 'load') return { modelId: 'model', fullyAccelerated: true };
            if (stale) { stale = false; return { error: 'expired', code: 'STALE_MODEL' }; }
            return { output: [3], fullyAccelerated: true };
        });
        expect(client.invoke({}, () => 'small graph', [2], 1, [1, 1], [file, null]).output).toEqual([3]);
        for (const request of requests.filter(r => r.action === 'invoke')) {
            expect(request.input).toEqual([2]);
            expect(request.inputFiles).toEqual([file, null]);
            expect(request.model).toBeUndefined();
        }
    });
    it('does not retry execution errors and bounds stale recovery', () => {
        let calls = 0;
        const client = createRamClient(r => {
            calls++;
            return r.action === 'load' ? { modelId: '1', fullyAccelerated: true } : { error: 'GPU failed' };
        });
        expect(() => client.invoke({}, () => 'model', [1], 1)).toThrow('GPU failed');
        expect(calls).toBe(2);
        const expired = createRamClient(r => r.action === 'load' ? { modelId: '1', fullyAccelerated: true }
            : { error: 'expired', code: 'STALE_MODEL' });
        expect(() => expired.invoke({}, () => '', [], 0)).toThrow('expired again');
    });
});

describe('RAM multiple resident parts', () => {
    it('retains A across A/B/A and releases all owned handles', () => {
        const requests: RamRequest[] = []; let sequence = 0;
        const live = new Set<string>();
        const client = createRamClient(request => {
            requests.push(request);
            if (request.action === 'load') { const modelId=String(++sequence);live.add(modelId);return {modelId,fullyAccelerated:true}; }
            if (request.action === 'release') {live.delete(request.modelId!);return {};}
            return live.has(request.modelId!) ? {output:[1],fullyAccelerated:true} : {error:'expired',code:'STALE_MODEL'};
        });
        client.invoke('a',()=> 'a',[1],1,[1],undefined,1024);
        client.invoke('b',()=> 'b',[1],1,[1],undefined,2048);
        expect(client.invoke('a',()=>{throw Error('A must stay loaded');},[2],1).cached).toBe(true);
        expect(requests.filter(r=>r.action==='load').map(r=>r.reservationBytes)).toEqual([1024,2048]);
        client.release();expect(live.size).toBe(0);
    });
    it('bounds client handles and drops the least recently used one', () => {
        let loads=0;const released:string[]=[];
        const client=createRamClient(request=>{
            if(request.action==='load')return {modelId:String(++loads),fullyAccelerated:true};
            if(request.action==='release'){released.push(request.modelId!);return {};}
            return {output:[1],fullyAccelerated:true};
        });
        for(const key of ['a','b','c','d','a','e'])client.invoke(key,()=>key,[1],1);
        expect(loads).toBe(5);expect(released).toEqual(['2']);
        client.invoke('a',()=>{throw Error('A was recently used');},[1],1);
        client.release();expect(new Set(released).size).toBe(5);
    });
    it('recovers an evicted part without reloading other parts', () => {
        let loads=0,staleA=false;
        const client=createRamClient(request=>{
            if(request.action==='load')return {modelId:String(++loads),fullyAccelerated:true};
            if(request.action==='invoke' && request.modelId==='1' && staleA)return {error:'evicted',code:'STALE_MODEL'};
            return {output:[1],fullyAccelerated:true};
        });
        client.invoke('a',()=> 'a',[1],1);client.invoke('b',()=> 'b',[1],1);staleA=true;
        expect(client.invoke('a',()=> 'a',[1],1).cached).toBe(false);
        expect(client.invoke('b',()=>{throw Error('B must stay loaded');},[1],1).cached).toBe(true);
        expect(loads).toBe(3);
    });
});
