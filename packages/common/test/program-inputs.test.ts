import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';
import { inputValues } from '@arrrank/interpreter';

describe('program input workspace', () => {
    it('restores supplied inputs on restart, replaces them, and allows returning to defaults', async () => {
        const session = createReplSession();
        const execute = (source: string) => session.execute(source, 1, source.split('\n'));
        try {
            session.setInputs(new Map([['Limit', inputValues(['10'], 'integer', false)]]));
            const source = 'use cli\narg Limit integer = 3\nLimit';
            expect((await execute(source)).output).toEqual([expect.objectContaining({ text: '10', error: false })]);
            await execute('Limit = 20');
            session.resetExecution(true);
            expect((await execute(source)).output).toEqual([expect.objectContaining({ text: '10', error: false })]);
            session.setInputs(new Map([['Limit', inputValues(['7'], 'integer', false)]]));
            expect((await execute(source)).output).toEqual([expect.objectContaining({ text: '7', error: false })]);
            session.setInputs(new Map());
            expect((await execute(source)).output).toEqual([expect.objectContaining({ text: '3', error: false })]);
        } finally { session.dispose(); }
    });
    it('starts array inputs with their supplied values after a restart', async () => {
        const session = createReplSession();
        try {
            session.setInputs(new Map([['Values', inputValues(['1', '2'], 'integer', true)]]));
            const source = 'use cli\nuse numbers\narg Values integer array\nValues += 1\nValues sum';
            const execute = () => session.execute(source, 1, source.split('\n'));
            expect((await execute()).output).toEqual([expect.objectContaining({ text: '5', error: false })]);
            session.resetExecution(true);
            expect((await execute()).output).toEqual([expect.objectContaining({ text: '5', error: false })]);
        } finally { session.dispose(); }
    });

});
