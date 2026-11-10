import { expect, it } from 'vitest';
import { Interpreter, isRankIndex, RuntimeDiagnostics } from '../src/index.js';
import { PrivateIntegerIndex, hasPrivateIndexStorage } from '../src/jit/number-loop-index.js';
function source() {
    const r = new Interpreter(() => {});
    const index = r.execute('use algo\nnew index');
    if (!index || !isRankIndex(index)) throw Error('expected index');
    index.entries.set(7, 11n); index.entries.set(9, 9007199254740993n);
    return { r, index };
}
it('rolls back appended keys and repeated writes without changing seeded order', () => {
    const { r, index } = source(), overflow = {};
    try {
        const before = [...index.entries], transaction = new PrivateIntegerIndex(index, overflow);
        transaction.set(20, 30); transaction.set(20, 40); transaction.set(7, 99);
        expect(transaction.read(20)).toBe(40); expect(transaction.read(7)).toBe(99);
        expect(transaction.has(20)).toBe(true); expect(transaction.readWide(9)).toBe(9007199254740993n);
        transaction.rollback();
        expect([...index.entries]).toEqual(before); expect(hasPrivateIndexStorage(index)).toBe(true);
    } finally { r.dispose(); }
});
it('publishes mixed old/new updates exactly once and retains insertion order', () => {
    const { r, index } = source(), d = new RuntimeDiagnostics();
    try {
        const transaction = new PrivateIntegerIndex(index, {});
        transaction.set(20, 30); transaction.set(20, 40); transaction.set(7, 99); transaction.set(21, 41);
        d.run(() => transaction.publish());
        expect([...index.entries]).toEqual([[7, 99n], [9, 9007199254740993n], [20, 40n], [21, 41n]]);
        expect(d.indexWrites).toBe(4);
    } finally { r.dispose(); }
});
it('removes a long append tail after an unsafe read without using host iterators', () => {
    const { r, index } = source(), overflow = {};
    try {
        const before = [...index.entries], transaction = new PrivateIntegerIndex(index, overflow);
        Object.defineProperty(index.entries, 'keys', { value: () => { throw Error('host keys'); } });
        for (let i = 0; i < 10000; i++) transaction.set(i + 100, i);
        let failed: unknown;
        try { transaction.read(9); } catch (error) { failed = error; }
        expect(failed).toBe(overflow); transaction.rollback();
        expect([...index.entries]).toEqual(before);
    } finally { r.dispose(); }
});

it('does not invoke host iterator next hooks during rollback', () => {
    const { r, index } = source();
    const prototype = Object.getPrototypeOf(new Map().keys()), next = prototype.next;
    try {
        const before = [...index.entries], transaction = new PrivateIntegerIndex(index, {});
        transaction.set(100, 200);
        prototype.next = () => { throw Error('host next'); };
        try { transaction.rollback(); } finally { prototype.next = next; }
        expect([...index.entries]).toEqual(before);
    } finally { prototype.next = next; r.dispose(); }
});

it('rejects an observable entries getter without reading it', () => {
    const { r, index } = source(), entries = index.entries;
    let reads = 0;
    try {
        Object.defineProperty(index, 'entries', { get() { reads++; return entries; } });
        expect(hasPrivateIndexStorage(index)).toBe(false);
        expect(reads).toBe(0);
    } finally { r.dispose(); }
});
