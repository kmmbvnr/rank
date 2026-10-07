import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { analyzeValues, createRankServices, functionSignature, isFunctionStatement, type Program } from '../src/index.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function signature(source: string, name: string, arguments_?: NonNullable<Parameters<typeof functionSignature>[1]>['arguments']) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements.find(node => isFunctionStatement(node) && node.name === name);
    if (!isFunctionStatement(definition)) throw new Error('missing function');
    const analysis = analyzeValues(parsed.value, new Map(), new Map(), arguments_ ? [{ name, arguments: arguments_ }] : []);
    return functionSignature(definition, { arguments: arguments_, result: analysis.functionResults[0],
        relationship: analysis.relationships.get(definition) });
}

it('displays identity and tuple relationships with unknown inputs', () => {
    expect(signature('fun identity Value\n return Value\nend', 'identity')).toBe('a → a');
    expect(signature('fun pair Value\n return tuple Value "label"\nend', 'pair')).toBe('a → tuple(a, text)');
    expect(signature('fun pair Left Right\n return tuple Left Right\nend', 'pair')).toBe('a b → tuple(a, b)');
});

it('retains relationships through composed helpers', () => {
    expect(signature('fun pair Value\n return tuple Value "label"\nend\nfun wrap Input\n return Input pair\nend', 'wrap'))
        .toBe('a → tuple(a, text)');
});

it('uses example types without guessing unconstrained arithmetic domains', () => {
    const source = 'fun twice Value\n return Value + Value\nend';
    expect(signature(source, 'twice')).toBe('a → a ; a: number ; numeric cells lift ; … (other domains)');
    expect(signature(source, 'twice', [{ types: ['integer'], rank: 0, shape: [] }])).toBe('integer → integer');
    expect(signature(source, 'twice', [{ types: ['array'], rank: 2, shape: [2, 3], elements: ['real'], callbackFreeScalarCells: true }]))
        .toBe('array[2, 3]<real> → array[2, 3]<real>');
});

it('does not mistake an unknown field requirement for a known field result', () => {
    const source = 'fun items State\n return State .items\nend';
    expect(signature(source, 'items')).toBe('a → ?');
    expect(signature(source, 'items', [{ types: ['record'], fields: { items: { types: ['text'], rank: 1, shape: [null] } } }]))
        .toBe('record → text');
});

it('displays proven literals independently of unknown operands', () => {
    expect(signature('fun answer Ignored\n return 42\nend', 'answer')).toBe('a → integer');
    expect(signature('fun answer\n return 42\nend', 'answer')).toBe('→ integer');
});

it('retains ordinary result facts when a relationship cannot prove reader safety', () => {
    expect(signature('fun twice Value\n return Value * 2\nend', 'twice', [
        { types: ['array'], rank: 1, shape: [3], elements: ['integer'] },
    ])).toBe('array[3]<integer> → array[3]<?>');
});

it('infers generator locals across branches and loop back edges', () => {
    const source = `fun facts N
 Rest = N
 D = 2
 Step = 1
 for Rest greater 1
  if D greater (Rest // D)
   yield Rest
  end
  if Rest mod D equal 0
   yield D
   Rest = Rest // D
  else
   D += Step
   Step = 2
  end
 end
end`;
    expect(signature(source, 'facts')).toBe('integer → sequence<integer> ; … (other domains)');
});

it('does not advertise incompatible generator writes or heterogeneous cells', () => {
    expect(signature('fun f N\n X = 1\n for N greater 0\n  yield X\n  X = X / 2\n  N -= 1\n end\nend', 'f'))
        .toBe('a → sequence');
    expect(signature('fun f N\n if N greater 0\n  X = 1\n else\n  X = 1.5\n end\n yield X\nend', 'f'))
        .toBe('a → sequence');
    expect(signature('fun f N\n for N greater 0\n  X = 1\n  N -= 1\n end\n yield X\nend', 'f')).toBe('a → sequence');
    expect(signature('fun f N\n yield N unknown_helper\nend', 'f')).toBe('a → sequence');
    expect(signature('fun f N\n yield 1.0\nend', 'f')).toContain('integer → sequence<real>');
});

it('keeps concrete four-argument inference independent of the symbolic body preview', () => {
    const source = 'fun sum4 A B C D\n return ((A + B) + C) + D\nend';
    const value = (type: 'integer' | 'real') => ({ types: [type], rank: 0, shape: [] });
    expect(signature(source, 'sum4')).toContain('a a a a → a ; a: number');
    expect(signature(source, 'sum4', Array(4).fill(value('integer'))))
        .toBe('integer integer integer integer → integer');
    expect(signature(source, 'sum4', Array(4).fill(value('real'))))
        .toBe('real real real real → real');
    expect(signature(source, 'sum4', [value('integer'), value('real'), value('integer'), value('integer')]))
        .toBe('integer real integer integer → ?');
});
