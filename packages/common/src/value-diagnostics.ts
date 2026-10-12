import { analyzeValues, describeTypes, functionTestExamples, isFunctionStatement, type ValueFacts, type FunctionStatement, type FunctionTestExample, type ImportedFunction, type Program } from '@arrrank/language';
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

export interface NotebookScope {
    bindings: Map<string, ValueFacts>; functions: Map<string, FunctionStatement>; clean: boolean;
    imports: Map<string, ImportedFunction>;
}

/** What the cells before the active one bind: analyzed, then replaced by the run's facts while those are fresh. */
export function notebookScope(book: Notebook, runtime: readonly [string, ValueFacts][] = [],
    loadModule?: (specifier: string) => Program | undefined,
    prefixes?: Map<number, NotebookScope>): NotebookScope {
    let bindings = new Map<string, ValueFacts>();
    let functions = new Map<string, FunctionStatement>();
    let imports = new Map<string, ImportedFunction>();
    // Notebook functions are registered before executing cells, including later definitions.
    for (const cell of prefixes?.has(0) ? [] : book.cells) {
        if (cell.command) continue;
        try {
            for (const definition of parse(cell.source).statements.filter(isFunctionStatement)) {
                functions.set(definition.name, definition);
                bindings.set(definition.name, { types: ['function'] });
            }
        } catch { /* Incomplete cells cannot declare a proven function. */ }
    }
    if (prefixes && !prefixes.has(0)) prefixes.set(0, { bindings, functions, imports, clean: false });
    let start = 0;
    for (const index of prefixes?.keys() ?? []) if (index <= book.active && index > start) start = index;
    const cached = prefixes?.get(start);
    if (cached) ({ bindings, functions, imports } = cached);
    const cleanPrefix = book.atPrompt && book.dirtyFrom < 0
        && book.cells.slice(0, book.active).every(cell => cell.command || cell.status === 'ok' && cell.executed === cell.source);
    for (let index = start; index < book.active; index++) {
        const cell = book.cells[index];
        if (!cell.command) {
            try {
                const analysis = analyzeValues(parse(cell.source), bindings, functions, [], loadModule, imports);
                bindings = new Map(analysis.bindings);
                functions = new Map(analysis.functions);
                imports = new Map(analysis.imports);
            } catch { bindings = new Map(); functions = new Map(); imports = new Map(); }
        }
        if (prefixes) {
            prefixes.set(index + 1, { bindings, functions, imports, clean: false });
            // Keep nearby prefixes without retaining a quadratic number of bindings in large files.
            if (prefixes.size > 33) prefixes.delete([...prefixes.keys()][1]);
        }
    }
    if (cleanPrefix) {
        bindings = new Map(bindings);
        const sequential = book.cells.slice(0, book.active).every((_, index) => !book.isExperimental(index));
        for (const [name, fact] of runtime) {
            const inferred = bindings.get(name);
            // Runtime metadata omits array cells. Keep proven source element
            // types only for an unchanged sequential prefix with matching shape.
            // Effectful calls and unsupported writes invalidate these facts in
            // the analyzer; proven single-cell scalar writes may retain them.
            const elements = sequential && inferred?.types.join() === fact.types.join()
                && inferred.rank === fact.rank && inferred.shape?.length === fact.shape?.length
                && inferred.shape?.every((size, axis) => size === fact.shape![axis])
                ? inferred.elements : undefined;
            bindings.set(name, { ...fact, ...(elements && !fact.elements ? { elements } : {}) });
        }
    }
    return { bindings, functions, clean: cleanPrefix, imports };
}

/** Source analysis replaces stale runtime facts as soon as an earlier cell changes. */
export function notebookValueDiagnostics(book: Notebook, runtime: readonly [string, ValueFacts][] = [],
    tests?: { path: string; examples: readonly FunctionTestExample[] },
    loadModule?: (specifier: string) => Program | undefined,
    scope?: NotebookScope): ReadonlyMap<number, OutputLine[]> {
    const output = new Map<number, OutputLine[]>();
    const current = book.current;
    if (current.command || !current.source.trim()) return output;
    const { bindings, functions, imports } = scope ?? notebookScope(book, runtime, loadModule);
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
        const analysis = analyzeValues(program, bindings, functions, examples, loadModule, imports);
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
