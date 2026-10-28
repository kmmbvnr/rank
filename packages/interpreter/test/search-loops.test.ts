import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string, compilation: boolean) {
    let loops = 0;
    const runtime = new Interpreter(() => {}, { compilation, onIntegerLoopExecuted: () => loops++ });
    try {
        let error: string | undefined;
        try { runtime.execute(source); }
        catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        return { error, loops, values: Object.fromEntries([...runtime.variables]
            .filter(([name]) => /^[A-Z]/.test(name)).map(([name, value]) => [name, formatValue(value)])) };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect({ ...compiled, loops: 0 }).toEqual({ ...reference, loops: 0 });
    return compiled;
}

it('executes the complete depth-array search as one loop and preserves the output snapshot', () => {
    // The default seed is already optimal: force the successful leaf to write
    // a new result, then mutate the candidate after the search has finished.
    const source = readFileSync(new URL('../../../demos/euler/103_specialsubset.ra', import.meta.url), 'utf8')
        .replace('Best = Seed sum', 'Best = Seed sum + 1')
        .replace('Found = Seed copy', 'Found = array shape Size fill 0');
    const result = compare(source + '\nSet 0 = 999');
    expect(result.error).toBeUndefined();
    expect(result.values.Answer).toBe('20313839404245');
    expect(result.values.Found).toBe('20 31 38 39 40 42 45');
    expect(result.values.Best).toBe('255');
    expect(result.values.Depth).toBe('-1');
    expect(result.loops).toBe(1);
}, 120000);

it('keeps multiword signed bits and the checked native domains in compiled loops', () => {
    const result = compare(`use bits
A = array shape 3 fill 0
B = 1
Flag = false
for I in 0 till 3
 B = B shl 100
 A I = B bor 1
 B = B shr 1
 C = B band -1
 D = C bxor 7
 E = D bnot
 Count = B popcount
 Flag = B bit (99 * (I + 1))
end`);
    expect(result.error).toBeUndefined();
    expect(result.values.Flag).toBe('true');
    expect(result.loops).toBe(1);
});

it.each(['shl', 'shr', 'bit'])('does not replay writes when %s rejects a negative count', operation => {
    const result = compare(`use bits
A = array shape 2 fill 0
Seen = 0
for I in 0 till 2
 Seen += 1
 A I = Seen
 Value = 1 ${operation} (0 - I)
end`);
    expect(result.error).toMatch(/nonnegative/);
    expect(result.values.Seen).toBe('2');
    expect(result.values.A).toBe('1 2');
    expect(result.loops).toBe(1);
});

it('retains the nonnegative popcount domain after partial writes', () => {
    const result = compare('use bits\nSeen = 0\nfor I in 0 till 2\n Seen += 1\n Count = (0 - I) popcount\nend');
    expect(result.error).toMatch(/nonnegative/);
    expect(result.values.Seen).toBe('2');
    expect(result.loops).toBe(1);
});

it('uses a shadowed bit function instead of the catalogue builtin', () => {
    const result = compare('fun A band B\n return A + B\nend\nTotal = 0\nfor I in 1 to 3\n Total += I band 8\nend');
    expect(result.error).toBeUndefined();
    expect(result.values.Total).toBe('30');
});

it.each([2, 3, 6, 12])('matches stack frame search in reference mode for limit %s', limit => {
    const source = readFileSync(new URL('../../../demos/euler/088_productsum_stack.ra', import.meta.url), 'utf8')
        .replace('arg Limit integer = 12000', `Limit = ${limit}`);
    const result = compare(source);
    expect(result.error).toBeUndefined();
    expect(result.values.Answer).toBe(String({ 2: 4, 3: 10, 6: 30, 12: 61 }[limit]));
});
