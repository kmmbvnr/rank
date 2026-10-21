import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices, type FunctionStatement, type Program } from '../src/index.js';
import { empty, escapeCalls } from '../src/analysis/function-escape-calls.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const [helper, callback] = parser.parse<Program>('fun A B helper = 0\nfun X callback = X').value.statements as FunctionStatement[];

describe('callback call summaries', () => {
    it('replays container writes when an equivalent call is reused', () => {
        let evaluations = 0;
        const invoke = escapeCalls((_fn, args) => {
            evaluations++;
            args[0].lazy.add(callback);
            args[0].stored.add(callback);
            return empty();
        });
        const first = empty(), second = empty();
        invoke(helper, [first], new Map());
        invoke(helper, [second], new Map());
        expect(evaluations).toBe(1);
        expect(second.lazy).toEqual(new Set([callback]));
        expect(second.stored).toEqual(new Set([callback]));
    });

    it('distinguishes aliased arguments from independent containers with equal provenance', () => {
        const invoke = escapeCalls((_fn, args) => {
            args[0].lazy.add(callback);
            return args[1];
        });
        const shared = empty();
        expect(invoke(helper, [shared, shared], new Map()).lazy).toEqual(new Set([callback]));
        expect(invoke(helper, [empty(), empty()], new Map()).lazy).toEqual(new Set());
    });

    it('keeps outer streams, nested streams and opaque capsules distinct in call keys', () => {
        let evaluations = 0;
        const invoke = escapeCalls((_fn, args) => { evaluations++; return args[0]; });
        for (const field of ['lazy', 'cells', 'opaque', 'stored'] as const) {
            const input = empty();
            input[field].add(callback);
            const result = invoke(helper, [input], new Map());
            expect(result[field]).toEqual(new Set([callback]));
        }
        expect(evaluations).toBe(4);
    });

});
