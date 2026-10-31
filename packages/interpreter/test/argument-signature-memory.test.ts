import v8 from 'node:v8';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { ownedArray } from '../src/array-storage.js';
import { setSemanticArrayType } from '../src/semantic-array-type.js';
import { argumentSignature } from '../src/return-contract.js';

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;
const used = () => process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;

it('releases completed argument arrays during one synchronous host job', () => {
    const key = argumentSignature([ownedArray([1n, 2n])]);
    collect();
    const before = used();
    // WeakRef keeps every target alive until this callback returns. These
    // completed integer buffers alone would retain more than 30 MiB.
    for (let i = 0; i < 2000; i++) {
        expect(argumentSignature([setSemanticArrayType(ownedArray(Array(4096).fill(BigInt(i))), { key: JSON.stringify(['integer']), scalar: 'integer' })])).toBe(key);
        if (i % 200 === 0) collect();
    }
    collect();
    expect(used() - before).toBeLessThan(8 * 1024 * 1024);
});
