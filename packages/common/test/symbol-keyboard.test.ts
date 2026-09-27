import { describe, expect, it } from 'vitest';
import { keyAvailable, keyboardTabs, keyText } from '../src/symbol-keyboard.js';
import { createReplSession } from '../src/repl-session.js';

describe('symbol keyboard', () => {
    it('offers core first and only the modules in use', () => {
        const tabs = keyboardTabs(['core', 'sequences', 'numbers']);
        expect(tabs.map(tab => tab.module)).toEqual(['core', 'numbers', 'sequences']);
        expect(tabs[0].keys).not.toContain('=');
        expect(tabs[0].keys).toContain('fun');
        expect(tabs[1].keys).toContain('sqrt');
        expect(tabs.flatMap(tab => tab.keys)).not.toContain('bfs');
    });

    it('drops modules that export no names', () => {
        expect(keyboardTabs(['testing']).map(tab => tab.module)).toEqual(['core']);
    });

    it('follows use statements in the session', async () => {
        const session = createReplSession();
        expect(keyboardTabs(session.modules).map(tab => tab.module)).toEqual(['core']);
        await session.execute('use graph', 1, []);
        expect(keyboardTabs(session.modules).map(tab => tab.module)).toEqual(['core', 'graph']);
    });

    it('offers keywords only where they can stand', () => {
        expect(keyAvailable('if', '')).toBe(true);
        expect(keyAvailable('if', 'fun f X\n  ')).toBe(true);
        expect(keyAvailable('if', 'X = ')).toBe(false);
        expect(keyAvailable('to', '')).toBe(false);
        expect(keyAvailable('to', 'X = 1 ')).toBe(true);
        expect(keyAvailable('to', 'X = 1 to ')).toBe(false);
        expect(keyAvailable('not', 'X = ')).toBe(true);
        expect(keyAvailable('sqrt', 'X = "a ')).toBe(false);
        expect(keyAvailable('sqrt', 'rem ')).toBe(false);
        expect(keyAvailable('sqrt', 'X = 2 ')).toBe(true);
    });

    it('spaces words apart from what precedes them', () => {
        expect(keyText('sqrt', '')).toBe('sqrt ');
        expect(keyText('sqrt', 'X')).toBe(' sqrt ');
        expect(keyText('sqrt', 'X ')).toBe('sqrt ');
        expect(keyText('sum', '(')).toBe('sum ');
    });
});
