import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { materializedArrayItems, ownedArray, writeArrayCell } from '../src/array-storage.js';
import { demandValue } from '../src/plan.js';

const products = [
    ['+', 114n], ['-', -66n], ['*', 360n],
] as const;

describe.each([false, true])('checked outer plans (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const sources: string[] = [], output: string[] = [];
        const diagnostics = new RuntimeDiagnostics();
        const host = new Interpreter(text => output.push(text), { compilation,
            onTensorKernelExecuted: () => entries++, onTensorKernelCompiled: source => sources.push(source) });
        host.variables.set('A', ownedArray([1n, 2n, 3n]));
        host.variables.set('B', ownedArray([10n, 20n]));
        return { host, sources, output, diagnostics, entries: () => entries,
            execute: (source: string) => diagnostics.run(() => host.execute(source)) };
    }

    it.each(products)('composes mapped operands and outer %s without storing cells', (operator, expected) => {
        const { host, execute, entries, sources, diagnostics } = runtime();
        try {
            execute(`Left' = A * 2\nRight' = B + 0\nProduct' = Left Right outer ${operator}\nTotal' = Product sum`);
            expect(entries()).toBe(0);
            expect(sources).toEqual([]);
            const product = diagnostics.run(() => demandValue(host.variables.get('Product')!));
            if (!isRankArray(product)) throw Error('expected product');
            expect(product.shape).toEqual([3, 2]);
            expect(materializedArrayItems(product)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(0);
            expect(execute('Total')).toBe(expected);
            expect(execute('Total')).toBe(expected);
            expect(entries()).toBe(compilation ? 2 : 0);
            if (compilation) {
                expect(sources).toHaveLength(1);
                expect(sources[0].match(/for \(/g)).toHaveLength(1);
                expect(sources[0]).not.toContain('new Array');
                expect(diagnostics.cellsComputed).toBe(0);
            }
        } finally { host.dispose(); }
    });

    it('preserves both operand shapes and a permutation after the product', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('A', ownedArray([1n, 2n, 3n, 4n], [2, 2]));
        host.variables.set('B', ownedArray([10n, 20n], [1, 2]));
        try {
            execute("use sequences\nProduct' = A B outer +\nPermuted' = Product transpose axis 3 2 1 0");
            const product = demandValue(host.variables.get('Product')!);
            expect(product).toMatchObject({ shape: [2, 2, 1, 2] });
            expect(execute('Permuted sum')).toBe(140n);
            expect(entries()).toBe(compilation ? 1 : 0);
            execute("Selected' = Permuted 0 # # #");
            expect(execute('Selected sum')).toBe(50n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('addresses a shared native operand separately in nested products', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute("Left' = A * 2\nPair' = Left Left outer -\nProduct' = Pair B outer *");
            expect(execute('Product sum')).toBe(0n);
            expect(execute('Product sum')).toBe(0n);
            expect(entries()).toBe(compilation ? 2 : 0);
            if (compilation) {
                expect(sources).toHaveLength(1);
                expect(sources[0].match(/for \(/g)).toHaveLength(1);
            }
            execute("Selected' = Product 2 # #");
            expect(execute('Selected sum')).toBe(180n);
            expect(entries()).toBe(compilation ? 3 : 0);
        } finally { host.dispose(); }
    });

    it('keeps a plain product native for a consumer after its scope has restored', () => {
        const { host, execute, entries } = runtime();
        try {
            execute("Product' = A B outer +");
            expect(execute('(Product + 1) sum')).toBe(108n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('keeps integer arithmetic exact above 2^53', () => {
        const { host, execute, entries } = runtime();
        const big = 2n ** 100n;
        host.variables.set('A', ownedArray([big, -big + 1n]));
        host.variables.set('B', ownedArray([big, big + 1n]));
        try {
            execute("Product' = A B outer *");
            expect(execute('Product sum')).toBe(2n * big + 1n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('promotes mixed numeric operands without changing the Cartesian domain', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('A', ownedArray([1n, 2n]));
        host.variables.set('B', ownedArray([0.5, 1.5]));
        try {
            execute("Product' = A B outer +");
            expect(execute('Product sum')).toBe(10);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it.each([['and', 1n], ['or', 3n], ['xor', 2n]] as const)(
        'supports an outer boolean %s followed by count', (operator, expected) => {
            const { host, execute, entries } = runtime();
            host.variables.set('A', ownedArray([true, false]));
            host.variables.set('B', ownedArray([false, true]));
            try {
                execute(`use sequences\nMask' = A B outer ${operator}`);
                expect(execute('Mask count')).toBe(expected);
                expect(entries()).toBe(compilation ? 1 : 0);
            } finally { host.dispose(); }
        });

    it('reuses code with fresh arguments and recomputes changed right-hand layouts', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute(`fun X' total Y'
 Product' = X Y outer *
 return Product sum
end
C = array 50
D = array 10 20`);
            expect(execute('A total B')).toBe(180n);
            expect(execute('D total B')).toBe(900n);
            expect(execute('A total C')).toBe(300n);
            expect(execute('A total B')).toBe(180n);
            expect(entries()).toBe(compilation ? 4 : 0);
            expect(sources).toHaveLength(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it.each(['sum', 'mean', 'min', 'max'])('preserves real row-major arithmetic and %s order', terminal => {
        const { host, execute, entries } = runtime();
        const left = [1e16, 1, -1e16], right = [1, 2];
        host.variables.set('A', ownedArray(left));
        host.variables.set('B', ownedArray(right));
        const cells = left.flatMap(a => right.map(b => a + b));
        const total = cells.reduce((sum, cell) => sum + cell, 0);
        const expected = terminal === 'sum' ? total : terminal === 'mean' ? total / cells.length
            : terminal === 'min' ? Math.min(...cells) : Math.max(...cells);
        try {
            execute("use stats\nProduct' = A B outer +");
            expect(execute(`Product ${terminal}`)).toBe(expected);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('stops before failing right cells but reports them for a full traversal', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('A', ownedArray([10n]));
        host.variables.set('B', ownedArray([2n, 0n]));
        try {
            execute("use sequences\nRight' = 12 // B\nProduct' = A Right outer +\nMask' = Product greater 0");
            expect(execute('Mask any')).toBe(true);
            expect(() => execute('Mask count')).toThrow(/zero/);
            expect(execute('Mask any')).toBe(true);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('stops before failing left rows and supports an outer comparison directly', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('A', ownedArray([2n, 0n]));
        host.variables.set('B', ownedArray([10n, 20n]));
        try {
            execute("use sequences\nLeft' = 12 // A\nMask' = Left B outer less");
            expect(execute('Mask any')).toBe(true);
            expect(() => execute('Mask count')).toThrow(/zero/);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('retains completed outer cells independently of further demand and writes', () => {
        const { host, execute, entries } = runtime();
        try {
            execute("Product' = A B outer +\nSaved = Product\nSaved 0 0 = 99");
            const saved = host.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected completed product');
            expect(materializedArrayItems(saved)).toEqual([99n, 21n, 12n, 22n, 13n, 23n]);
            expect(execute('Saved sum')).toBe(190n);
            expect(execute('Product sum')).toBe(102n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('retains empty scalar geometry while declining observable empty producers', () => {
        const { host, execute, entries, output } = runtime();
        host.variables.set('A', ownedArray([], [2, 0]));
        try {
            execute("Product' = A B outer +");
            expect(demandValue(host.variables.get('Product')!)).toMatchObject({ shape: [2, 0, 2] });
            expect(execute('Product sum')).toBe(0n);
            const before = entries();
            execute(`use io
fun X empty rank 0
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0
Other' = Rows B outer +`);
            expect(execute('Other sum')).toBe(0n);
            expect(execute('Other sum')).toBe(0n);
            expect(output).toEqual(['1', '2', '1', '2']);
            expect(entries()).toBe(before);
            // A physical empty result is already a completion boundary.
            expect(before).toBe(0);
        } finally { host.dispose(); }
    });

    it('does not probe opaque operands to obtain a native capability', () => {
        const { host, execute, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('A', { kind: 'array', shape: [2], get items(): never { throw Error('collect'); },
            itemAt(index) { reads.push(index); return BigInt(index + 1); } });
        try {
            execute("Product' = A B outer +\nTotal' = Product sum");
            expect(reads).toEqual([]);
            expect(execute('Total')).toBe(66n);
            expect(reads).toEqual([0, 1]);
            expect(execute('Total')).toBe(66n);
            expect(reads).toEqual([0, 1, 0, 1]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('repeats named callback effects through canonical outer traversal', () => {
        const { host, execute, entries, output } = runtime();
        try {
            execute(`use io
fun X added Y rank 0 0
 X print
 return X + Y
end
Product' = A B outer added`);
            expect(output).toEqual([]);
            expect(execute('Product sum')).toBe(102n);
            expect(execute('Product sum')).toBe(102n);
            expect(output).toEqual(['1', '1', '2', '2', '3', '3', '1', '1', '2', '2', '3', '3']);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('preserves range addressing without walking a large operand', () => {
        const { host, execute, entries } = runtime();
        try {
            execute("Range' = 1 to 100000000\nProduct' = Range B outer *");
            expect(execute('Product 99999999 1')).toBe(2000000000n);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('checks work limits on warm outer code and can retry after cancellation', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('A', ownedArray(Array(128).fill(1n)));
        host.variables.set('B', ownedArray(Array(128).fill(2n)));
        try {
            execute("Product' = A B outer +");
            expect(execute('Product sum')).toBe(49152n);
            expect(() => withDemandBudget(100, () => execute('Product sum'))).toThrow(DemandBudgetExhausted);
            expect(execute('Product sum')).toBe(49152n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });
});

it('revalidates the actual outer source after the compilation observer changes it', () => {
    const a = ownedArray([1n, 2n]), b = ownedArray([10n, 20n]);
    let entries = 0, compilations = 0;
    const host = new Interpreter(undefined, {
        onTensorKernelExecuted: () => entries++,
        onTensorKernelCompiled() { if (++compilations === 1) writeArrayCell(a, 0, 99n); },
    });
    host.variables.set('A', a); host.variables.set('B', b);
    try {
        host.execute("Product' = A B outer +");
        expect(host.execute('Product sum')).toBe(262n);
        expect(entries).toBe(0);
        expect(compilations).toBe(1);
    } finally { host.dispose(); }
});
