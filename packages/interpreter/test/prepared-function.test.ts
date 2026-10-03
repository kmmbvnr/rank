import { EmptyFileSystem } from 'langium';
import { expect, it, vi } from 'vitest';
import { Interpreter, isNativeFunction, type RankValue } from '../src/index.js';
import { createRankServices, isFunctionStatement, type Program } from '@arrrank/language';
import { prepareFunction } from '../src/prepared-function.js';

const services = createRankServices(EmptyFileSystem);

function borrowed(source: string): ReadonlySet<string> {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements.find(isFunctionStatement)!;
    return prepareFunction(definition).borrowedParameters;
}

it('borrows direct scalar reads but not array-derived results', () => {
    expect(borrowed('fun read X\n return X 0\nend')).toEqual(new Set(['X']));
    expect(borrowed('fun read X\n return (X 0) * 2\nend')).toEqual(new Set(['X']));
    expect(borrowed('fun transform X\n return X * 2\nend')).toEqual(new Set());
    expect(borrowed('fun transform X\n return X\nend')).toEqual(new Set());
});

it.each([false, true])('reuses primitive call preparations without serializing changing values (scalar kernels=%s)', scalarFunctionCompilation => {
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation });
    try {
        runtime.execute('fun identity Value\n return Value\nend');
        const fn = runtime.variables.get('identity');
        if (!fn || !isNativeFunction(fn)) throw new Error('expected identity');
        // Create each specialization once, including rank-1 text.
        for (const value of [1n, 1.5, true, 'a']) expect(fn.call([value])).toBe(value);
        const stringify = vi.spyOn(JSON, 'stringify');
        try {
            const values: RankValue[] = [2n, -9n, 5.25, false, '😀different length', 11n, 8.5, ''];
            for (const value of values) expect(fn.call([value])).toBe(value);
            expect(stringify).not.toHaveBeenCalled();
        } finally { stringify.mockRestore(); }
    } finally { runtime.dispose(); }
});
