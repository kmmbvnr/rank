import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('collection consumer chains', () => {
    for (const chain of ['sort unique', 'unique sum']) {
        it.each(['array 3 1 3 2', 'array 3.5 1.5 3.5', 'array shape 0 fill 0',
            'array 9223372036854775808 1 9223372036854775808'])
        (`${chain} matches separate calls for %s`, input => {
            const [first, second] = chain.split(' ');
            const setup = `use sequences\nV = ${input}\n`;
            expect(run(setup + `V ${chain}`)).toBe(run(setup + `T = V ${first}\nT ${second}`));
        });
    }
});
