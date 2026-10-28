import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

function config() {
    const vocab: Record<string, number> = {};
    let extra = 256;
    for (let b = 0; b < 256; b++) vocab[String.fromCodePoint(b >= 33 && b <= 126 || b >= 161 && b <= 172 || b >= 174 ? b : extra++)] = b;
    Object.assign(vocab, { ab: 256, abc: 257, '<|endoftext|>': 258 });
    return { pre_tokenizer: { type: 'ByteLevel', add_prefix_space: false }, decoder: { type: 'ByteLevel' },
        added_tokens: [{ id: 258, content: '<|endoftext|>', special: true }],
        model: { type: 'BPE', vocab, merges: ['a b', 'ab c'] } };
}
function runtime(c = config()) {
    const r = new Interpreter(); r.variables.set('Config', JSON.stringify(c)); r.execute('use text'); return r;
}
describe('byte-level BPE', () => {
    it('merges by rank and preserves Unicode, whitespace, BOM and special tokens', () => {
        const r = runtime();
        expect(r.execute('"abc abc" bpeencode Config')).toMatchObject({ items: [257n, 32n, 257n] });
        for (const text of ['', 'abc\t\n  abc ', 'Привет 👋', '\u0085x\ufeff', '\ufeffabc', "WE'RE we're", '<|endoftext|>abc']) {
            r.variables.set('Text', text); r.execute('Ids = Text bpeencode Config');
            expect(r.execute('Ids bpedecode Config')).toBe(text);
        }
        expect(r.execute('"<|endoftext|>" bpeencode Config')).toMatchObject({ items: [258n] });
    });
    it('decodes bytes together and replaces incomplete UTF-8 only at the boundary', () => {
        const r = runtime();
        expect(r.execute('(array 195 169) bpedecode Config')).toBe('é');
        expect(r.execute('(array 195) bpedecode Config')).toBe('�');
        expect(() => r.execute('(array -1) bpedecode Config')).toThrow('token ID');
        expect(() => r.execute('(array 999) bpedecode Config')).toThrow('token ID');
        expect(() => r.execute('(array 1.0) bpedecode Config')).toThrow('token ID');
    });
    it('rejects unsupported configs, malformed inputs and ambiguous IDs', () => {
        const c = config(); c.pre_tokenizer.add_prefix_space = true;
        expect(() => runtime(c).execute('"abc" bpeencode Config')).toThrow('requires unnormalized');
        const duplicate = config(); duplicate.model.vocab.ab = 0;
        expect(() => runtime(duplicate).execute('"abc" bpeencode Config')).toThrow('duplicate');
        const r = runtime(); r.variables.set('Text', '\ud800');
        expect(() => r.execute('Text bpeencode Config')).toThrow('well-formed Unicode');
        expect(() => r.execute('1 bpeencode Config')).toThrow('expects text');
        expect(() => r.execute('"abc" bpeencode "bad"')).toThrow('invalid JSON');
    });
    it('does not reuse token IDs after changing the tokenizer', () => {
        const r = runtime(); r.execute('Ids = "abc" bpeencode Config');
        const changed = config(); changed.model.vocab.abc = 300;
        r.variables.set('Config', JSON.stringify(changed));
        expect(r.execute('"abc" bpeencode Config')).toMatchObject({ items: [300n] });
    });
});
