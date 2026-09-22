import assert from 'node:assert/strict';
import test from 'node:test';
import { Interpreter, isRankBytes } from '@arrrank/interpreter';
import { nodeMd5 } from '../out/node-crypto.js';

test('Node MD5 agrees with the portable backend for text and binary input', () => {
    const portable = new Interpreter();
    const native = new Interpreter(undefined, { md5: nodeMd5 });
    try {
        for (const runtime of [portable, native]) runtime.execute('use crypto\nuse text');
        for (const source of ['""', '"abc"', '"Ä😀"', '(array 0 128 255) bytes', '"abc" bytes']) {
            const expected = portable.execute(`${source} md5 hex`);
            assert.equal(native.execute(`${source} md5 hex`), expected);
        }
        for (const size of [55, 56, 63, 64, 65, 127, 128, 1000]) {
            const text = 'x'.repeat(size);
            assert.equal(native.execute(`"${text}" md5 hex`), portable.execute(`"${text}" md5 hex`));
        }
        assert.ok(isRankBytes(native.execute('"abc" md5')));
    } finally {
        portable.dispose();
        native.dispose();
    }
});

test('the host MD5 provider is inherited by imports and tests', () => {
    let calls = 0;
    const runtime = new Interpreter(undefined, {
        md5: value => { calls += 1; return nodeMd5(value); },
        loadModule: () => ({ id: '/hash.ra', source: 'use crypto\nfun digest Value\n return Value md5\nend' }),
    });
    try {
        runtime.execute('use testing\nuse text\nuse "hash"\ntest "hash"\n use text\n use "hash"\n "abc" digest hex equal "900150983cd24fb0d6963f7d28e17f72"\nend');
        assert.equal(runtime.testResults[0].passed, true, runtime.testResults[0].error);
        assert.equal(calls, 1);
        assert.equal(runtime.execute('"abc" digest hex'), '900150983cd24fb0d6963f7d28e17f72');
        assert.equal(calls, 2);
    } finally {
        runtime.dispose();
    }
});
