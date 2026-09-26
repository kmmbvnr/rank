import { describe, expect, it } from 'vitest';
import { Interpreter, pureHostFunction } from '../src/index.js';
import { withTypedCalls, typedNativeCall } from '../src/typed-native.js';
import { native } from '../src/modules/shared.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

describe('typed native kernels', () => {
    it('requires the complete signature and the registered function identity', () => {
        const kernel = () => true;
        const value = withTypedCalls(native('example', 2, () => false), { 'text,text': kernel });
        expect(typedNativeCall(value, ['text', 'text'])).toBe(kernel);
        for (const types of [['text'], ['text', 'bytes'], ['bytes', 'text'], ['toString']]) {
            expect(typedNativeCall(value, types)).toBe(value.call);
        }
        const copy = { ...value };
        expect(typedNativeCall(copy, ['text', 'text'])).toBe(copy.call);
        expect(value.call(['a', 'b'])).toBe(false);
        expect(() => value.call(['a'])).toThrow(/expects/);
    });

    it('keeps native cancellation checks when an interactive signal is installed', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const value = withTypedCalls(native('example', 1, () => {
            Atomics.store(signal, 0, 1);
            return true;
        }), { text: () => false });
        withInterrupt(signal, () => {
            expect(typedNativeCall(value, ['text'])).toBe(value.call);
            expect(() => typedNativeCall(value, ['text'])(['a'])).toThrow(InterruptedError);
        });
        expect(typedNativeCall(value, ['text'])(['a'])).toBe(false);
    });

    it('does not authorize compilation of an arbitrary registered function', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.variables.set('example', withTypedCalls(native('example', 1, () => 7n), {
                text: () => 99n,
            }));
            expect(runtime.execute('R = 0\nfor I in 1 to 2\n R = "a" example\nend\nR')).toBe(7n);
            expect(loops).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('rebinds a cached loop when execution enters an interrupt scope', () => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const runtime = new Interpreter(undefined, {
            // Cancellation simulates an external request arriving during the host call.
            md5: pureHostFunction(() => {
                Atomics.store(signal, 0, 1);
                return new Uint8Array(16);
            }),
        });
        try {
            runtime.execute('use crypto\nfun work\n H = "" bytes\n for I in 1 to 2\n  H = "abc" md5\n end\n return H\nend');
            runtime.execute('work');
            Atomics.store(signal, 0, 0);
            expect(() => withInterrupt(signal, () => runtime.execute('work'))).toThrow(/md5/);
            expect(runtime.execute('work')).toBeDefined();
        } finally { runtime.dispose(); }
    });

    it.each([
        ['""', '""', true], ['"a"', '"ab"', false], ['"😀ёж"', '"😀"', true],
        ['"abc"', '"z"', false], ['"abc"', '"abc"', true],
    ])('matches checked text and byte prefixes: %s, %s', (value, prefix, expected) => {
        for (const typedNativeCalls of [false, true]) {
            const runtime = new Interpreter(undefined, { typedNativeCalls });
            try {
                runtime.execute('use text');
                for (const convert of ['', ' bytes']) {
                    expect(runtime.execute(`R = false\nfor I in 1 to 2\n R = (${value}${convert}) (${prefix}${convert}) startswith\nend\nR`)).toBe(expected);
                }
                expect(() => runtime.execute('1 2 startswith')).toThrow(/expects/);
            } finally { runtime.dispose(); }
        }
    });

    it('preserves byte identity and Unicode lowercasing in compiled loops', () => {
        for (const typedNativeCalls of [false, true]) {
            const runtime = new Interpreter(undefined, { typedNativeCalls });
            try {
                runtime.execute('use text\nB = "😀" bytes\nC = "" bytes\nS = ""\nfor I in 1 to 2\n C = B bytes\n S = "İЁ😀" lower\nend');
                expect(runtime.variables.get('C')).toBe(runtime.variables.get('B'));
                expect(runtime.variables.get('S')).toBe('İЁ😀'.toLowerCase());
            } finally { runtime.dispose(); }
        }
    });
});
