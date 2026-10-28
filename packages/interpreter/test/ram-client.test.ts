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
