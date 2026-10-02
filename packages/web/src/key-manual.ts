import { findOperation, moduleForms, type Operation } from '@arrrank/language';

export interface ManualEntry {
    name: string;
    summary: string;
    synopsis: string;
    description: string;
    examples: { code: string; template?: boolean }[];
}

// Bundle the maintained reference with the app: the manual also works offline.
const references = import.meta.glob('../../../docs/{language,stdlib}/*.md', {
    eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;
const sections = Object.entries(references).flatMap(([path, text]) => {
    const parts = text.split(/^#{1,3} (.+)$/m);
    return parts.slice(1).flatMap((title, i) => i % 2 === 0
        ? [{ path, title, text: parts[i + 2] ?? '' }] : []);
});
const topics: [string[], string, string][] = [
    [['for', 'break', 'continue'], 'control-functions', 'For'],
    [['if', 'elif', 'else'], 'control-functions', 'Conditionals'],
    [['end'], 'control-functions', 'Block scope'],
    [['fun', 'return'], 'control-functions', 'Functions'],
    [['memo'], 'control-functions', 'Memoized functions'],
    [['yield'], 'control-functions', 'Generator functions'],
    [['try', 'catch', 'finally'], 'control-functions', 'Errors and exceptions'],
    [['use'], 'modules-programs', 'Standard modules'],
    [['as'], 'modules-programs', 'Source modules'],
    [['run'], 'modules-programs', 'Running programs'],
    [['args', 'argument', 'flag', 'option'], 'modules-programs', 'Program inputs'],
    [['test'], 'testing', 'Testing'],
    [['unpack'], 'lexical-syntax', 'Unpacking assignment'],
    [['record'], 'lexical-syntax', 'Records'],
    [['true', 'false', 'is'], 'lexical-syntax', 'Scalar types'],
    [['and', 'or', 'xor', 'not', 'equal', 'not equal', 'less', 'greater', 'at least', 'at most', 'in'], 'values-addressing', 'General form'],
    [['to', 'till', 'from', 'after'], 'sequences-arrays', 'Bounds'],
    [['by'], 'values-addressing', 'Slices and ranges'],
    [['take', 'drop'], 'sequences-arrays', 'Take and drop'],
    [['array', 'fill'], 'sequences-arrays', 'Array construction'],
    [['shape'], 'sequences-arrays', 'Shape and size'],
    [['rank'], 'sequences-arrays', 'Rank'],
    [['axis'], 'tensors', 'Axis reductions'],
    [['reduce'], 'sequences-arrays', 'Reduce'],
    [['scan'], 'sequences-arrays', 'Scan'],
    [['outer'], 'sequences-arrays', 'Outer'],
    [['first where', 'first index where'], 'sequences-arrays', 'Short-circuiting selection'],
    [['sort by', 'argsort by', 'ascending', 'descending'], 'sequences-arrays', 'Ordering and uniqueness'],
    [['filter'], 'sequences-arrays', 'Filter clause'],
    [['select'], 'tables', 'Select columns'],
    [['group by'], 'tables', 'Grouping'],
    [['leftjoin by', 'innerjoin by', 'leftjoin on', 'innerjoin on'], 'tables', 'Join'],
    [['default'], 'values-addressing', 'Missing-value defaults'],
    [['index'], 'collections', 'Index'],
    [['new', 'push'], 'collections', 'Queue, stack, deque and heap'],
    [['set add'], 'collections', 'Set'],
    [['counter add'], 'collections', 'Counter'],
];
const examplesByKey: Record<string, string> = {
    sqrt: 'use numbers\n9 sqrt', sum: '(1 to 5) sum', len: '"hello" len',
    integer: '"42" integer', real: '"3.5" real', text: '42 text', bytes: '"Rank" bytes',
    max: '3 5 max', min: '3 5 min', take: '"abcdef" take 3', drop: '"abcdef" drop 3',
    default: 'A = array 1 2\nA 5 default 0', for: 'for i in 1 to 3\n  i\nend',
    true: 'true', false: 'false', not: 'not false', is: '42 is .integer',
    'set add': 'use algo\nset add 3\nset len', 'counter add': 'use algo\ncounter add "a"\ncounter "a"',
};
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();
const contains = (text: string, key: string) => new RegExp(`(?<![\\w])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(text);

const syntax: Record<string, string> = {
    args: 'args Values', argument: 'argument Name Type = Default', flag: 'flag Name', option: 'option Name Type = Default',
    array: 'array Values\nSequence array', record: 'record\n  .field = Value\nend', index: 'index Key = Value',
    for: 'for Item in Values\n  Statements\nend', if: 'if Condition\n  Statements\nend',
    elif: 'if Condition\n  Statements\nelif Condition\n  Statements\nend',
    else: 'if Condition\n  Statements\nelse\n  Statements\nend', end: 'Block\n  Statements\nend',
    break: 'for\n  break\nend', continue: 'for Item in Values\n  continue\nend',
    fun: 'fun name Parameters\n  return Value\nend', memo: 'memo name Parameters\n  return Value\nend',
    return: 'return Value', yield: 'yield Value', try: 'try\n  Statements\ncatch Error\n  Statements\nend',
    catch: 'try\n  Statements\ncatch Error\n  Statements\nend',
    finally: 'try\n  Statements\nfinally\n  Statements\nend',
    run: 'run "program.ra"', use: 'use Module\nuse "module.ra" as Name', as: 'use "module.ra" as Name',
    test: 'test "name"\n  Condition\nend', unpack: 'unpack Names = Values\nunpack Values',
    stdin: 'stdin .Type\nCount stdin .Type', new: 'new Kind', push: 'Container push Value',
    true: 'true → boolean', false: 'false → boolean', not: 'not Value → boolean',
    and: 'Left and Right → boolean', or: 'Left or Right → boolean', xor: 'Left xor Right → boolean',
    equal: 'Left equal Right → boolean', 'not equal': 'Left not equal Right → boolean',
    less: 'Left less Right → boolean', greater: 'Left greater Right → boolean',
    'at least': 'Left at least Right → boolean', 'at most': 'Left at most Right → boolean',
    'multiple by': 'Value multiple by Divisor → boolean', in: 'Value in Collection → boolean', is: 'Value is .Type → boolean',
    to: 'Low to High', till: 'Low till High', by: 'Low to High by Step', from: 'Values from Low', after: 'Values after Low',
    take: 'Values take Count', drop: 'Values drop Count', default: 'Address default Fallback',
    shape: 'Values shape\narray shape Dimensions fill Value', fill: 'array shape Dimensions fill Value',
    rank: 'Values Function rank N\nLeft Right Function rank M N', axis: 'Values Function axis N',
    reduce: 'Values reduce Operator', scan: 'Values scan Operator', outer: 'Left Right outer Operator',
    'sort by': 'Values sort by Key', 'argsort by': 'Values argsort by Key', 'group by': 'Rows group by .field',
    'first where': 'Values first where Condition', 'first index where': 'Values first index where Condition',
    filter: 'Values filter Condition', select: 'Rows select .fields\nRows select\n  .field = Expression\nend',
    'leftjoin by': 'Left Right leftjoin by .field', 'innerjoin by': 'Left Right innerjoin by .field',
    'leftjoin on': 'Left Right leftjoin on .left .right', 'innerjoin on': 'Left Right innerjoin on .left .right',
    'set add': 'set add Value', 'counter add': 'counter add Value', ascending: 'Values sort .ascending', descending: 'Values sort .descending',
};

function signature(operation: Operation): string {
    const domains = operation.operandDomains?.map((domain, i) => `Operand ${i + 1}: ${domain?.join(' | ') ?? 'value'}`).join('\n');
    return `${operation.form} → ${operation.result}\nOperands: ${operation.arities.join(' or ') || 'none (builtin value)'}${domains ? '\n' + domains : ''}`;
}

export function keyManual(key: string, module: string): ManualEntry {
    const operation = findOperation(key);
    const forms = moduleForms.filter(form => contains(form.form, key));
    const topic = topics.find(([keys]) => keys.includes(key));
    const preferred = topic ? sections.filter(section => section.path.endsWith('/' + topic[1] + '.md') && section.title === topic[2])
        : operation ? sections.filter(section => section.path.endsWith('/stdlib/modules.md')
            && section.title.toLowerCase().startsWith(({ algo: 'algorithm', io: 'file i/o', linalg: 'linear algebra', crypto: 'cryptography' } as Record<string, string>)[operation.module] ?? operation.module)) : [];
    const relevant = preferred.length ? preferred : sections.filter(section => contains(section.text, key));
    const paragraphs = relevant.flatMap(section => section.text.replace(/```[\s\S]*?```/g, '').trim().split(/\n\s*\n/));
    const prose = (operation ? paragraphs.filter(paragraph => contains(paragraph, key))
        : paragraphs.some(paragraph => paragraph.includes('`' + key + '`'))
            ? paragraphs.filter(paragraph => paragraph.includes('`' + key + '`')) : paragraphs).slice(0, 4);
    const owner = operation?.module ?? forms[0]?.module ?? module;
    const imports = (code: string, required: string) => {
        const used = new Set(required === 'core' ? [] : [required]);
        const localFunctions = new Set([...code.matchAll(/(?:fun|memo) ([a-z][a-z0-9]*)/g)].map(match => match[1]));
        // Include imports for other builtin names used by a reference example.
        for (const word of code.replace(/"(?:\\.|[^"\\])*"/g, '').match(/\b[a-z][a-z0-9]*\b/g) ?? []) {
            const dependency = localFunctions.has(word) ? undefined : findOperation(word)?.module;
            if (dependency && dependency !== 'core') used.add(dependency);
        }
        return [...used].filter(name => !code.includes('use ' + name)).map(name => `use ${name}\n`).join('') + code;
    };
    const samples = relevant.flatMap(section => [...section.text.matchAll(/```rank\n([\s\S]*?)```/g)]
        .map(match => match[1].trim()).filter(code => !code.includes('...') && !code.includes('…') && contains(code, key)
            && (!operation || code.split('\n').some(line => contains(line, key) && line.trim() !== key))))
        .sort((a, b) => a.length - b.length);
    const examples = [...new Set([
        ...(examplesByKey[key] ? [examplesByKey[key]] : []),
        ...forms.map(form => imports(form.example, form.module)),
        ...samples.map(code => imports(code, owner)),
    ])].slice(0, 3).map(code => ({ code }));
    const prefix = owner === 'core' ? '' : `use ${owner}\n`;
    const synopsis = operation ? signature(operation) : syntax[key] ?? forms[0]?.form ?? key;
    return {
        name: key,
        summary: operation?.summary ?? forms[0]?.summary ?? plain(prose[0] ?? `Language keyword: ${key}.`).split(/(?<=\.)\s/)[0].replace(/\s+/g, ' '),
        synopsis,
        description: [
            ...(operation ? [operation.summary,
                ...(operation.lazy ? ['The result is lazy: values are computed when requested.'] : []),
                ...(operation.effects?.length ? [`Effects: ${operation.effects.join(', ')}.`] : []),
                ...(operation.monadicRank !== undefined ? [`Unary cell rank: ${operation.monadicRank}.`] : []),
                ...(operation.dyadicRanks ? [`Binary cell ranks: ${operation.dyadicRanks.join(', ')}.`] : []),
            ] : []),
            ...prose.map(plain),
            owner === 'core' ? 'Available without a module import.' : `Requires use ${owner}.`,
        ].join('\n\n'),
        examples: examples.length ? examples : [{ code: prefix + (operation?.form ?? syntax[key] ?? key), template: true }],
    };
}
