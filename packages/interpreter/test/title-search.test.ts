import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/dyalog/2011/005_search.ra', import.meta.url), 'utf8');
const items = (value: RankValue) => {
    if (!isRankArray(value)) throw new Error('expected array');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) },
        (_, i) => value.itemAt?.(i) ?? value.items[i]);
};
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const reference = (titles: string[], query: string) => {
    const dictionary = [...new Set(titles.flatMap(tokens))];
    const counts = (text: string) => {
        const words = tokens(text);
        return dictionary.map(word => words.filter(token => token === word).length);
    };
    const q = counts(query);
    if (!q.some(Boolean)) return [];
    const magnitude = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return titles.map((title, index) => {
        const v = counts(title);
        return { title, index, score: v.reduce((sum, x, i) => sum + x * q[i], 0) / (magnitude(v) * magnitude(q)) };
    }).filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 10).map(hit => hit.title);
};

for (const compiled of [false, true]) describe(`title search (compiled=${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(() => {}, { scalarCompilation: compiled, scalarFunctionCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        r.execute(source);
        return r;
    };
    it('builds a T by D count matrix and T cosine scores', () => {
        const r = runtime();
        try {
            r.execute('Dict = Titles makeDict\nCounts = Dict dictCount Titles rank 1 0\nQueryVec = Dict dictCount "Error Trapping"\nScores = Counts cosine QueryVec rank 1 1');
            const titles = items(r.variables.get('Titles')!) as string[];
            const dict = items(r.variables.get('Dict')!) as string[];
            expect(r.variables.get('Counts')).toMatchObject({ shape: [titles.length, dict.length] });
            expect(items(r.variables.get('Counts')!).map(Number)).toEqual(titles.flatMap(title =>
                dict.map(word => tokens(title).filter(token => token === word).length)));
            expect(r.variables.get('QueryVec')).toMatchObject({ shape: [dict.length] });
            expect(r.variables.get('Scores')).toMatchObject({ shape: [titles.length] });
        } finally { r.dispose(); }
    });
    it('matches independent retrieval across varied queries, Unicode, ties and duplicates', () => {
        const r = runtime();
        try {
            const titles = ['', '!?', 'APL APL J', 'J with APL', 'APL APL J', 'Пожар-42', 'Été ٣',
                ...Array.from({ length: 14 }, (_, i) => `shared item${i}`), 'Only unrelated'];
            r.execute(`Titles = array ${titles.map(title => JSON.stringify(title)).join(' ')}`);
            for (const query of ['APL', 'apl J J', 'Пожар 42', 'ÉTÉ ٣', 'shared', 'unrelated', 'absent', '', '!?']) {
                const actual = r.execute(`Titles seek ${JSON.stringify(query)}`)!;
                expect(items(actual)).toEqual(reference(titles, query));
                expect(actual).toMatchObject({ shape: [reference(titles, query).length] });
            }
        } finally { r.dispose(); }
    });
    it('preserves division by zero for standalone zero-vector cosine', () => {
        const r = runtime();
        try {
            expect(() => r.execute('(array 0 0) cosine (array 1 0)')).toThrow(/division by zero/i);
            expect(() => r.execute('(array 1 0) cosine (array 0 0)')).toThrow(/division by zero/i);
        } finally { r.dispose(); }
    });
    it('handles empty title collections and empty dictionaries', () => {
        const r = runtime();
        try {
            for (const titles of ['(array shape 0 fill "")', '(array "" "!?")']) {
                const actual = r.execute(`${titles} seek "anything"`)!;
                expect(actual).toMatchObject({ shape: [0] });
                expect(items(actual)).toEqual([]);
            }
            expect(items(r.execute('(array "x" "x" "missing") dictCount "x"')!)).toEqual([1n, 1n, 0n]);
            expect(items(r.execute('(array "x" "y") dictCount ""')!)).toEqual([0n, 0n]);
        } finally { r.dispose(); }
    });
});
