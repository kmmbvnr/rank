import assert from 'node:assert/strict';

// Unsafe attribution controls only. Never use this loader as a Rank backend:
// these experiments intentionally omit overflow/widening contracts. Euler
// 287's fixed N <= 24 inputs fit Number, with all stack stores fitting Int32.
const experiment = process.env.GUARDS;
assert(['safe', 'stores', 'both'].includes(experiment));
const NativeFunction = globalThis.Function;
let patched = 0;
process.on('exit', code => { if (code === 0) assert(patched > 0, 'expected Number kernel was not compiled'); });
globalThis.Function = function (...args) {
    if (args[0] !== 'safe' || args[1] !== 'int32' || !String(args.at(-1)).includes('changed2')) {
        return NativeFunction(...args);
    }
    patched++;
    if (experiment === 'stores' || experiment === 'both') {
        const code = String(args.at(-1));
        let removed = 0;
        args[args.length - 1] = code.replace(
            /if \(cells\d+ instanceof Int32Array && operand\d+ !== \(operand\d+ \| 0\)\) \{\s*cells\d+ = cells\[\d+\] = new Float64Array\(cells\d+\);\s*\}/g,
            () => { removed++; return ''; });
        assert.equal(removed, 12, 'original Euler 287 should have twelve stack stores');
    }
    const factory = NativeFunction(...args);
    return (...bindings) => {
        if (experiment === 'safe' || experiment === 'both') bindings[0] = value => value;
        return factory(...bindings);
    };
};
