import { analyzeValues, describeTypes, functionTestExamples, isFunctionStatement, type ValueFacts, type FunctionStatement, type FunctionTestExample } from '@arrrank/language';
import { isNativeFunction, isRankArray, parse, type RankValue } from '@arrrank/interpreter';
import type { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';

/** Copy metadata, never array cells, lazy sequences, getters or function results. */
export function runtimeValueFacts(values: ReadonlyMap<string, RankValue>,
    acceptedTypes: (name: string) => readonly string[] | undefined = () => undefined,
    acceptedArrayRank: (name: string) => number | undefined = () => undefined): [string, ValueFacts][] {
    const facts: [string, ValueFacts][] = [];
    for (const [name, value] of values) {
        if (isNativeFunction(value)) continue;
        let fact: ValueFacts;
        if (typeof value !== 'object') {
            const type = typeof value === 'bigint' ? 'integer' : typeof value === 'number' ? 'real'
                : typeof value === 'string' ? 'text' : 'boolean';
            fact = { types: [type], rank: type === 'text' ? 1 : 0, shape: type === 'text' ? [null] : [],
                ...(typeof value === 'bigint' && value >= -BigInt(Number.MAX_SAFE_INTEGER)
                    && value <= BigInt(Number.MAX_SAFE_INTEGER) ? { integer: String(value) } : {}) };
        } else if (isRankArray(value)) {
            fact = { types: [value.kind], rank: value.shape.length, shape: [...value.shape],
                ...(value.kind === 'bytes' ? { elements: ['integer'] } : {}) };
        } else fact = { types: [value.kind === 'label' ? 'symbol' : value.kind] };
        facts.push([name, { ...fact, acceptedTypes: acceptedTypes(name), acceptedArrayRank: acceptedArrayRank(name) }]);
    }
    return facts;
}

/** Source analysis replaces stale runtime facts as soon as an earlier cell changes. */
export function notebookValueDiagnostics(book: Notebook, runtime: readonly [string, ValueFacts][] = [],
    tests?: { path: string; examples: readonly FunctionTestExample[] }): ReadonlyMap<number, OutputLine[]> {
    let bindings = new Map<string, ValueFacts>();
    let functions = new Map<string, FunctionStatement>();
    const output = new Map<number, OutputLine[]>();
    const current = book.current;
    if (current.command || !current.source.trim()) return output;
    const cleanPrefix = book.atPrompt && book.dirtyFrom < 0
        && book.cells.slice(0, book.active).every(cell => cell.command || cell.status === 'ok' && cell.executed === cell.source);
    {
        for (const cell of book.cells.slice(0, book.active)) {
            if (cell.command) continue;
            try {
                const analysis = analyzeValues(parse(cell.source), bindings, functions);
                bindings = new Map(analysis.bindings);
                functions = new Map(analysis.functions);
            } catch { bindings.clear(); functions.clear(); }
        }
    }
    if (cleanPrefix) {
        const sequential = book.cells.slice(0, book.active).every((_, index) => !book.isExperimental(index));
        for (const [name, fact] of runtime) {
            const inferred = bindings.get(name);
            // Runtime metadata omits array cells. Keep proven source element
            // types only for an unchanged sequential prefix with matching shape.
            // Calls and element writes invalidate these facts in the analyzer.
            const elements = sequential && inferred?.types.join() === fact.types.join()
                && inferred.rank === fact.rank && inferred.shape?.length === fact.shape?.length
                && inferred.shape?.every((size, axis) => size === fact.shape![axis])
                ? inferred.elements : undefined;
            bindings.set(name, { ...fact, ...(elements && !fact.elements ? { elements } : {}) });
        }
    }
    try {
        const program = parse(current.source);
        const definitions = program.statements.filter(isFunctionStatement);
        const locatedExamples = (tests?.examples ?? []).map(example => ({ example,
            path: tests!.path.split(/[\\/]/).at(-1)! }));
        try {
            if (definitions.length) {
                const source = book.cells.filter(cell => !cell.command).map(cell => cell.source).join('\n');
                locatedExamples.push(...functionTestExamples(parse(source)).map(example => ({ example, path: 'this file' })));
            }
        } catch {
            // Incomplete source cannot supply reliable local test examples.
        }
        const relevantExamples = locatedExamples.filter(({ example }) => definitions.some(definition => definition.name === example.name));
        const examples = relevantExamples.map(({ example }) => example);
        const analysis = analyzeValues(program, bindings, functions, examples);
        for (const diagnostic of analysis.diagnostics) {
            const line = (diagnostic.node.$cstNode?.range.start.line ?? 0) + 1;
            const text = `${diagnostic.kind}: ${diagnostic.message}`;
            output.set(line, [...output.get(line) ?? [], { text, inlineText: text, error: true }]);
        }
        for (const [index, example] of examples.entries()) {
            const definition = definitions.find(definition => definition.name === example.name)!;
            const line = (definition.$cstNode?.range.start.line ?? 0) + 1;
            const location = `${relevantExamples[index].path}:${example.line}`;
            const signature = example.arguments.map(argument => describeTypes(argument.types)).join(', ');
            const inferred = describeTypes(analysis.functionResults[index].types);
            const expected = describeTypes(example.expected.types);
            const text = `Test ${location}: ${example.name}(${signature})\nExpected: ${expected}\nFrom code: ${inferred}`;
            output.set(line, [...output.get(line) ?? [], { text, error: false }]);
        }
    } catch {
        // A draft with incomplete syntax has no proven semantic error yet.
    }
    return output;
}
