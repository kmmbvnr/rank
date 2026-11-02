import { readFileSync } from 'node:fs';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { expect, it } from 'vitest';
import {
    applicationForm, createRankServices,
    isApplicationExpression, type Program,
} from '../src/index.js';

const parse = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);

// Parentheses may delimit a special call's source even when stripping them
// leaves the same flattened application tree.
it.each([
    '092_squarechains', '142_perfectsquares', '177_quadrilaterals',
    '178_stepnumbers', '213_fleacircus', '434_rigidgrid',
    '481_chefshowdown', '509_divisornim', '511_nicesequences',
    '519_tricolouredcoin', '536_modulopower', '603_primeconcatenation',
    '609_pisequences', '619_squaresubsets', '640_shutthebox',
    '644_squaresontheline', '651_patternedcylinders', '696_mahjong',
])('keeps valid application boundaries in Euler %s', async name => {
    const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
    const document = await parse(source);
    expect(document.parseResult.parserErrors).toEqual([]);
    const invalid: string[] = [];
    function visit(value: unknown, parent?: unknown, key?: string): void {
        if (!value || typeof value !== 'object') return;
        if (isApplicationExpression(value)) {
            const head = isApplicationExpression(parent) && key === 'head';
            if (!head) {
                const form = applicationForm(value);
                if (form.kind === 'invalid') invalid.push(form.message);
            }
        }
        for (const [name, child] of Object.entries(value)) {
            if (name.startsWith('$')) continue;
            if (Array.isArray(child)) child.forEach(item => visit(item, value, name));
            else visit(child, value, name);
        }
    }
    visit(document.parseResult.value);
    expect(invalid).toEqual([]);
});
