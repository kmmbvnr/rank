import { loopTraversal } from './loop-traversal.js';
import { prepareNumberLoop } from './number-loop-runtime.js';
import { loopValueType, type IterationBinding, type LoopHost, type LoopTerm, type CompiledLoop } from './integer-loop-plan.js';
import { prepareIntegerLoop } from './integer-loop-runtime.js';
import { compiledIntegerMembership } from './integer-membership.js';
import { type CompiledCalleeType } from './compiled-callee-type.js';
import { ResourceMap } from './resource-summary.js';
import { compiledArgumentType } from './compiled-argument-type.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    applicationForm, isExpressionStatement, flattenApplication, expressionFacts, findOperation, findCompiledOperator, inferCompiledExpression, loopOperatorSignature,
    isAssignmentStatement, isIfStatement, isForStatement, isBreakStatement, isContinueStatement, isPushStatement, isArrayAssignmentStatement, isApplicationExpression, isBinaryExpression, isUnaryExpression,
    isStringLiteral, isReturnStatement, isArrayExpression, isParenthesizedExpression, isNumberLiteral, isNameExpression,
    type Expression, type ForStatement, type Statement, type CompiledLoopType, type CompiledExpression, type Operation,
} from '@arrrank/language';
import { isRankArray, isRankIndex, type RankArray, type RankValue } from './value.js';
import { RankDeque } from './containers.js';
import { materializedArrayItems, arrayRevision } from './array-storage.js';


/** Pure builtins inlined as `Value name`. `types` maps each accepted operand
 * type to the result type; the entry guard rechecks the binding each time. */
interface InlineBuiltin {
    readonly module: string;
    readonly types: Partial<Record<LoopTerm['type'], LoopTerm['type']>>;
    readonly enabled?: (host: LoopHost) => boolean;
    /** The interpreter's DomainError for operands outside the domain. */
    readonly domain?: { test(value: string, type: LoopTerm['type']): string | undefined; message: string };
    code(value: string, type: LoopTerm['type'], numberMode: boolean): string;
}
const parity = (even: boolean): InlineBuiltin => ({ module: 'numbers', types: { integer: 'boolean' },
    code: (value, _, numberMode) => numberMode ? `((${value}) % 2 ${even ? '===' : '!=='} 0)`
        : `(BigInt.asUintN(1, ${value}) ${even ? '===' : '!=='} 0n)` });
const bound = (name: 'floor' | 'ceil'): InlineBuiltin => ({ module: 'numbers', types: { integer: 'integer', real: 'integer' },
    enabled: host => host.reals,
    domain: { test: (value, type) => type === 'real' ? `!Number.isFinite(${value})` : undefined, message: `${name} expects a finite number` },
    code: (value, type) => type === 'real' ? `BigInt(Math.${name}(${value}))` : value });
const inlineBuiltins = new Map<string, InlineBuiltin>([
    ['abs', { module: 'numbers', types: { integer: 'integer', real: 'real' }, enabled: host => host.absolute,
        code: (value, type, numberMode) => type === 'real' ? `Math.abs(${value})`
            : `(${value}) < ${numberMode ? '0' : '0n'} ? -(${value}) : (${value})` }],
    ['even', parity(true)],
    ['odd', parity(false)],
    ['sqrt', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `(${value}) < 0`, message: 'sqrt expects a nonnegative value' },
        code: (value, type) => `Math.sqrt(${type === 'integer' ? `Number(${value})` : value})` }],
    ['floor', bound('floor')],
    ['ceil', bound('ceil')],
]);

export function compileIntegerLoop(statement: ForStatement, host: LoopHost, iteration?: IterationBinding): CompiledLoop | undefined {
    const sources: string[] = [];
    const numericHost = host.compiled ? { ...host, compiled: (source: string) => sources.push(source) } : host;
    const exact = compileTypedLoop(statement, numericHost, iteration, new Set(), new Set());
    const fast = exact && buildTypedLoop(statement, numericHost, iteration, new Set(), new Set(), () => {}, true);
    if (sources.length) host.compiled?.(sources.join('\n'));
    const numeric: CompiledLoop | undefined = exact && fast ? { run: (...context) => fast.run(...context) ?? exact.run(...context) } : exact;
    if (!host.textLoops) return numeric;
    const candidates = new Set<string>();
    function collect(node: Statement) {
        if (isForStatement(node)) {
            let input = host.iteration(node.condition)?.iterable;
            while (input && isParenthesizedExpression(input)) input = input.value;
            if (input && isNameExpression(input) && !input.name.includes('.')) candidates.add(input.name);
            node.statements.forEach(collect);
        } else if (isIfStatement(node)) {
            node.thenStatements.forEach(collect);
            node.elseStatements.forEach(collect);
            node.elifClauses.forEach(branch => branch.statements.forEach(collect));
        }
    }
    collect(statement);
    if (!candidates.size) return numeric;
    // Cache type signatures, never values or invocation frames. Keep growth bounded.
    const variants = new Map<string, CompiledLoop | undefined>();
    return { run: (insideFinally, insideGenerator, tailCallsAllowed) => {
        const result = numeric?.run(insideFinally, insideGenerator, tailCallsAllowed);
        if (result) return result;
        const text: string[] = [], textArrays: string[] = [];
        for (const name of candidates) {
            const value = host.read(name);
            if (typeof value === 'string') text.push(name);
            else if (host.textArrayLoops && value && isRankArray(value) && value.shape.length === 1
                && arrayRevision(value) !== undefined) {
                // This only selects a candidate plan; its entry guard checks every cell.
                const items = materializedArrayItems(value);
                if (items && typeof items[0] === 'string') textArrays.push(name);
            }
        }
        if (!text.length && !textArrays.length) return recordFallback('loop:no-text-specialization');
        const key = JSON.stringify([text, textArrays]);
        if (!variants.has(key)) {
            if (variants.size >= 8) return recordFallback('loop:specialization-budget');
            variants.set(key, compileTypedLoop(statement, host, iteration, new Set(text), new Set(textArrays)));
        }
        return variants.get(key)?.run(insideFinally, insideGenerator, tailCallsAllowed);
    } };
}

function compileTypedLoop(statement: ForStatement, host: LoopHost, iteration: IterationBinding | undefined, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>): CompiledLoop | undefined {
    let failure: string | undefined;
    const result = buildTypedLoop(statement, host, iteration, textSources, textArrays, reason => { failure ??= reason; });
    if (!result && currentDiagnostics()) recordFallback(failure ?? compilerRejection('loop', statement));
    return result;
}

function buildTypedLoop(statement: ForStatement, host: LoopHost, iteration: IterationBinding | undefined,
    textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, failed: (reason: string) => void, numberMode = false): CompiledLoop | undefined {
    const zero = numberMode ? '0' : '0n', one = numberMode ? '1' : '1n';
    const safe = (code: string) => numberMode ? `safe(${code})` : code;
    const dirty = (slot: number) => numberMode ? `if (!d${slot}) d${slot} = ++order;` : '';
    function reject(node: Expression | Statement, detail?: string): undefined {
        failed(compilerRejection('loop', node, detail));
        return undefined;
    }
    if (!statement.statements.length || statement.statements.length > 32) return reject(statement, 'statement-budget');
    const localTypes = new Map<string, LoopTerm['type']>();
    const names: string[] = [], required = new Set<number>(), assigned = new Set<string>();
    const writers: ((value: RankValue) => void)[] = [];
    const binders: ((value: RankValue) => void)[] = [];
    const writerNames: string[] = [], binderNames: string[] = [];
    const written = new Set<string>();
    const containers = new Map<string, { slot: number; kind: 'index' | 'deque'; integers: boolean; mode?: RankDeque['mode'] }>();
    const builtins = new Map<string, string>();
    const calls: { name: string; locals: readonly string[]; stableArrayReads: boolean;
        bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined }[] = [];
    const arrays = new Map<string, { slot: number; rank: number; type: LoopTerm['type'] }>();
    const calleeArrays = new Set<string>();
    const arrayInputs = new Set<string>(), arrayDefinitions = new Set<string>();
    const aliases: [string, string][] = [];
    const graphMutations: string[] = [];
    const vectorIterations: { slot: number; binding: IterationBinding }[] = [];
    const iterators: ((source: RankArray | RankDeque | string) => Iterable<RankValue>)[] = [];
    const destinations = new Map<string, { slot: number; rank: number; compound: boolean; type?: LoopTerm['type'] }>();
    let needsAlgo = false, hasControl = false, hasReturn = false;
    let serial = 0;
    function container(name: string, kind: 'index' | 'deque', integers = false): string | undefined {
        if (name.includes('.')) return undefined;
        const old = containers.get(name);
        if (old && old.kind !== kind) return undefined;
        const info = old ?? { slot: slot(name), kind, integers };
        info.integers ||= integers;
        containers.set(name, info);
        return `r${info.slot}`;
    }
    function slot(name: string): number {
        let index = names.indexOf(name);
        if (index < 0) { index = names.length; names.push(name); }
        return index;
    }
    function knownType(expression: Expression): LoopTerm['type'] | undefined {
        const fact = expressionFacts(expression, name => {
            const local = localTypes.get(name);
            if (local) return { types: [local] };
            // This only selects a specialization; required inputs are guarded
            // again on every entry. Never retain a value or invocation frame.
            const type = loopValueType(host.read(name));
            return type && { types: [type] };
        });
        const type = fact.types.length === 1 ? fact.types[0] : undefined;
        return type === 'integer' || type === 'boolean' || type === 'text' || type === 'bytes'
            || type === 'real' && host.reals ? type : undefined;
    }
    /** Real bindings and arrays of reals select real registers. This only
     * chooses a specialization; entry guards check every input and cell. */
    function realInput(name: string): 'real' | undefined {
        if (!host.reals) return undefined;
        const value = host.read(name);
        const first = value && isRankArray(value)
            ? arrayRevision(value) === undefined ? undefined : materializedArrayItems(value)?.[0] : value;
        return typeof first === 'number' ? 'real' : undefined;
    }
    const isExtreme = (part: Expression | undefined) => isNameExpression(part) && ['min', 'max'].includes(part.name);
    // `A B max`, `A max`, or a chain such as `A B max 5 min` that ends in scalar extrema.
    function extremeChain(parts: readonly Expression[]): boolean {
        if (!isExtreme(parts.at(-1))) return false;
        if (parts.length === 2 || parts.length === 3) return !isExtreme(parts[0]) && !isExtreme(parts.at(-2));
        return parts.length > 3 && !isExtreme(parts.at(-2)) && extremeChain(parts.slice(0, -2));
    }
    function emitExtreme(parts: readonly Expression[], lines: string[]): LoopTerm | undefined {
        const last = parts.at(-1);
        if (!isNameExpression(last)) return undefined;
        const left = parts.length > 3 ? emitExtreme(parts.slice(0, -2), lines) : emit(parts[0], lines);
        if (left?.type !== 'integer' && left?.type !== 'real') return undefined;
        builtins.set(last.name, 'core');
        if (parts.length === 2) return left;
        // Mixed operands would give a result of either type.
        const right = emit(parts.at(-2)!, lines);
        if (right?.type !== left.type) return undefined;
        const name = `v${serial++}`;
        lines.push(`const ${name} = (${right.code}) ${last.name === 'min' ? '<' : '>'} (${left.code}) ? (${right.code}) : (${left.code});`);
        return { code: name, type: left.type };
    }
    interface LoopInput { readonly term: LoopTerm; readonly lines: readonly string[] }
    function emit(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        let tailSource = e;
        while (isParenthesizedExpression(tailSource)) tailSource = tailSource.value;
        const booleanPairs = new Map<Expression, boolean>();
        const types: readonly CompiledLoopType[] = ['integer', 'boolean', 'bytes',
            ...host.textLoops ? ['text' as const] : [], ...host.reals ? ['real' as const] : []];
        const inferred = inferCompiledExpression<CompiledLoopType, LoopInput>(e, {
            atom: type => types.find(candidate => candidate === type),
            read: (source, expected) => {
                // Scalar operators use the shared inference. Loop-specific cell
                // reads, calls and literal powers retain their guarded lowering.
                if (isUnaryExpression(source) || isBinaryExpression(source)
                    && source.operator !== '**' && source.operator !== 'in' && source.operator !== 'notin') return undefined;
                const inputLines: string[] = [];
                const term = emitInput(source, inputLines, expected, tail && source === tailSource);
                return term ? { type: term.type, input: { term, lines: inputLines } } : undefined;
            },
            isBound: name => localTypes.has(name) || arrays.has(name) || containers.has(name),
            operandHint: (source, index, left) => {
                if (isUnaryExpression(source)) return source.operator === 'not' ? 'boolean' : undefined;
                if (!isBinaryExpression(source)) return undefined;
                if (index === 1) return left === 'text' ? 'text'
                    : booleanPairs.get(source) || left === 'boolean' ? 'boolean' : undefined;
                const text = loopOperatorSignature(source.operator, ['text', 'text'], host.nativeCalls);
                const boolean = loopOperatorSignature(source.operator, ['boolean', 'boolean'], host.nativeCalls);
                const textPair = text && knownType(source.right) === 'text';
                const booleanPair = !!boolean && (!loopOperatorSignature(source.operator, ['integer', 'integer'], host.nativeCalls)
                    || knownType(source.right) === 'boolean');
                booleanPairs.set(source, booleanPair);
                return textPair || text?.result === 'text' && knownType(source.left) === 'text'
                    ? 'text' : booleanPair ? 'boolean' : undefined;
            },
            // Literal powers are handled by the guarded input path. Accepting
            // the generic overload here would admit computed/negative exponents.
            operator: (operation, inputs) => {
                if (operation.name === '**') return undefined;
                const signature = loopOperatorSignature(operation.name, inputs, host.nativeCalls);
                return signature?.result === 'real' && !host.reals ? undefined : signature;
            },
            budget: { remaining: 1024 },
        }, hint);
        if (inferred.failure) return reject(inferred.failure.source, inferred.failure.detail);
        return lower(inferred.expression, lines) ?? reject(e);
    }
    function lower(node: CompiledExpression<CompiledLoopType, LoopInput>, lines: string[]): LoopTerm | undefined {
        // Reals use the exact backend, whose registers hold Rank values.
        if (serial > 256 || numberMode && node.type === 'real') return undefined;
        if (node.kind === 'group') return lower(node.operand, lines);
        if (node.kind === 'literal') {
            const value = node.value;
            if (numberMode && typeof value === 'bigint' && !Number.isSafeInteger(Number(value))) return undefined;
            return { type: node.type, code: typeof value === 'bigint' ? `${value}${numberMode ? '' : 'n'}`
                : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : JSON.stringify(value) };
        }
        if (node.kind === 'input') {
            lines.push(...node.input.lines);
            return node.input.term;
        }
        if (node.kind === 'call') return undefined; // Calls are guarded loop inputs above.
        if (node.kind === 'unary') {
            const value = lower(node.operand, lines), token = node.operation.unary;
            if (!value || token === undefined) return undefined;
            return { code: token === '' ? value.code : node.type === 'integer' ? safe(`${token}(${value.code})`) : `${token}(${value.code})`, type: node.type };
        }
        const left = lower(node.left, lines);
        const token = node.operation.binary;
        const guard = token === '&&' || token === '||';
        const rightLines: string[] = guard ? [] : lines;
        const right = lower(node.right, rightLines);
        if (!left || !right || !token) return undefined;
        if (guard) {
            const name = `v${serial++}`;
            lines.push(`let ${name} = ${left.code}; if (${node.operation.name === 'and' ? '' : '!'}${name}) { ${rightLines.join('\n')} ${name} = ${right.code}; }`);
            return { code: name, type: node.type };
        }
        const code = arithmetic(node.operation.name, left, right, node.type, lines);
        return code === undefined ? undefined : { code, type: node.type };
    }
    /** One checked binary operator. Compound assignments lower through it
     * too, so division by zero and floor rounding are written once. */
    function arithmetic(op: string, left: LoopTerm, right: LoopTerm, type: LoopTerm['type'], lines: string[]): string | undefined {
        const token = findCompiledOperator(op)?.binary;
        if (!token) return undefined;
        const a = left.code, b = right.code, name = `v${serial++}`;
        if (op === '/' || left.type === 'real' || right.type === 'real') {
            // The interpreter's coercions: Number for arithmetic, exact
            // bigint/number relations, and `==` for integral equality.
            if (token === '//' || token === '%') return undefined;
            const real = (term: LoopTerm) => term.type === 'integer' ? `Number(${term.code})` : `(${term.code})`;
            const mixed = left.type !== right.type;
            const relation = mixed && token === '===' ? '==' : mixed && token === '!==' ? '!=' : token;
            if (op === '/') lines.push(`if ((${b}) === ${right.type === 'integer' ? '0n' : '0'}) throw zero();`);
            lines.push(`const ${name} = ${type === 'boolean' ? `(${a}) ${relation} (${b})` : `${real(left)} ${token} ${real(right)}`};`);
            return name;
        }
        if (token !== '//' && token !== '%') {
            lines.push(`const ${name} = ${type === 'integer' ? safe(`(${a}) ${token} (${b})`) : `(${a}) ${token} (${b})`};`);
            return name;
        }
        const remainder = `m${serial++}`;
        lines.push(`if ((${b}) === ${zero}) throw zero();`, `const ${remainder} = (${a}) % (${b});`);
        const adjust = `(${remainder} !== ${zero} && (${remainder} < ${zero}) !== ((${b}) < ${zero}))`;
        const quotient = numberMode ? safe(`${safe(`(${a}) - ${remainder}`)} / (${b})`) : `(${a}) / (${b})`;
        lines.push(`const ${name} = ${safe(op === '//' ? `${quotient} - (${adjust} ? ${one} : ${zero})` : `${remainder} + (${adjust} ? (${b}) : ${zero})`)};`);
        return name;
    }
    /** Lower an audited catalogue call. Argument reads remain in source order;
     * runtime binding still checks the module and current builtin on every entry. */
    function emitBuiltinCall(operation: Operation, operands: readonly Expression[], lines: string[]): LoopTerm | undefined {
        if (numberMode) return undefined;
        const signature = operation.compiledCall!;
        const arguments_: string[] = [];
        const types: string[] = [];
        let firstType: LoopTerm['type'] | undefined;
        for (const [index, input] of signature.inputs.entries()) {
            let part = operands[index];
            while (isParenthesizedExpression(part)) part = part.value;
            if (input === 'text-array') {
                if (!host.textArrayLoops || !isNameExpression(part) || part.name.includes('.')) return undefined;
                const previous = arrays.get(part.name);
                if (previous && (previous.rank !== 1 || previous.type !== 'text')
                    || localTypes.has(part.name)) return undefined;
                const info = previous ?? { slot: slot(part.name), rank: 1, type: 'text' as const };
                arrays.set(part.name, info);
                if (!assigned.has(part.name)) arrayInputs.add(part.name);
                arguments_.push(`r${info.slot}`);
                types.push('text-array');
                continue;
            }
            const expected = input === 'text-or-array' ? 'text' : input === 'same' ? firstType
                : input === 'text-or-bytes' ? knownType(part) ?? (isNameExpression(part) ? 'text' : undefined) : input;
            const value = emit(operands[index], lines, expected);
            if (!value || expected && value.type !== expected
                || input === 'text-or-bytes' && !['text', 'bytes'].includes(value.type)) return undefined;
            firstType ??= value.type;
            arguments_.push(value.code);
            types.push(value.type);
        }
        const name = `v${serial++}`, index = calls.length;
        // Catalogue compiled calls are synchronous operations with
        // no Rank callbacks; bind() checks the current builtin.
        calls.push({ name: operation.name, locals: [], stableArrayReads: true,
            bind: host.prepareBuiltinCall(operation.module, operation.name, types) });
        lines.push(`const ${name} = calls[${index}]([${arguments_.join(',')}]);`);
        return { code: name, type: signature.result };
    }
    function emitInput(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        if (serial > 256) return undefined;
        if (isNameExpression(e) && !e.name.includes('.')) {
            if (arrays.has(e.name)) return undefined;
            const type = localTypes.get(e.name) ?? (textSources.has(e.name) ? 'text' : hint ?? realInput(e.name) ?? 'integer');
            if (hint && type !== hint || type === 'boolean' && !host.booleanLocals) return undefined;
            localTypes.set(e.name, type);
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            return { code: `r${index}`, type };
        }
        if (host.extrema && isApplicationExpression(e)) {
            const parts = host.extremeParts(e);
            if (parts && extremeChain(parts)) return emitExtreme(parts, lines);
        }
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if (!numberMode && op === 'text' && host.scalarText) {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'core');
                const name = `v${serial++}`;
                lines.push(`const ${name} = (${value.code}).toString();`);
                // Decimal integer rendering has one UTF-16 unit per code point.
                return { code: name, type: 'text', ascii: true };
            }
            if (!numberMode && op === 'len' && host.scalarText) {
                if (host.nativeCalls && knownType(e.head) === 'bytes') {
                    const value = emit(e.head, lines, 'bytes');
                    if (!value) return undefined;
                    builtins.set(op, 'core');
                    return { code: `BigInt(${value.code}.shape[0])`, type: 'integer' };
                }
                const array = isNameExpression(e.head) ? arrays.get(e.head.name) : undefined;
                if (array && isNameExpression(e.head)) {
                    if (!assigned.has(e.head.name)) arrayInputs.add(e.head.name);
                    builtins.set(op, 'core');
                    return { code: `BigInt(r${array.slot}.shape[0] ?? 0)`, type: 'integer' };
                }
                const knownText = isStringLiteral(e.head) || isApplicationExpression(e.head)
                    || isParenthesizedExpression(e.head)
                    || isNameExpression(e.head) && (localTypes.get(e.head.name) === 'text' || textSources.has(e.head.name));
                if (knownText) {
                    const value = emit(e.head, lines);
                    if (value?.type !== 'text') return undefined;
                    builtins.set(op, 'core');
                    const name = `v${serial++}`;
                    lines.push(`const ${name} = BigInt(${value.ascii ? `(${value.code}).length` : `[...(${value.code})].length`});`);
                    return { code: name, type: 'integer' };
                }
            }
            const builtin = inlineBuiltins.get(op);
            if (builtin && (builtin.enabled?.(host) ?? true) && flattenApplication(e).length === 2) {
                const value = emit(e.head, lines);
                const type = value && builtin.types[value.type];
                if (!value || !type) return undefined;
                builtins.set(op, builtin.module);
                const test = builtin.domain?.test(value.code, value.type);
                if (test) lines.push(`if (${test}) throw domain(${JSON.stringify(builtin.domain!.message)});`);
                const name = `v${serial++}`;
                lines.push(`const ${name} = ${builtin.code(value.code, value.type, numberMode)};`);
                return { code: name, type };
            }
            if (!numberMode && (op === 'len' || op === 'pop') && isNameExpression(e.head)) {
                const receiver = container(e.head.name, 'deque', op === 'pop');
                if (!receiver) return undefined;
                builtins.set(op, op === 'len' ? 'core' : 'algo');
                const name = `v${serial++}`;
                lines.push(`const ${name} = ${op === 'len' ? `BigInt(${receiver}.size)` : `${receiver}.pop()`};`);
                return { code: name, type: 'integer' };
            }
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1);
            if (last && isNameExpression(last) && !last.name.includes('.')) {
                const operation = host.nativeCalls ? findOperation(last.name) : undefined;
                const signature = operation?.compiledCall;
                const prepareCallee = host.scalarFunction(last.name, parts.length - 1);
                // Prefer a known user function while its namesake module is unopened.
                // An unresolved name can still bind the builtin after a later import.
                if (operation && signature && signature.inputs.length === parts.length - 1
                    && (host.module(operation.module) || !prepareCallee)) {
                    return emitBuiltinCall(operation, parts.slice(0, -1), lines);
                }
                if (prepareCallee && !numberMode) {
                    const arguments_: string[] = [];
                    const types: CompiledCalleeType[] = [];
                    for (let part of parts.slice(0, -1)) {
                        while (isParenthesizedExpression(part)) part = part.value;
                        const existing = isNameExpression(part) ? arrays.get(part.name) : undefined;
                        const current = isNameExpression(part) && !localTypes.has(part.name) ? host.read(part.name) : undefined;
                        if (current && isNameExpression(part) && (current instanceof RankDeque
                            || isRankIndex(current) && current.entries instanceof ResourceMap)) {
                            const kind = current instanceof RankDeque ? 'deque' : 'index';
                            const receiver = container(part.name, kind);
                            if (!receiver) return undefined;
                            containers.get(part.name)!.integers = true;
                            arguments_.push(receiver);
                            if (current instanceof RankDeque) {
                                containers.get(part.name)!.mode = current.mode;
                                types.push({ kind: 'deque', mode: current.mode });
                            } else types.push({ kind: 'index' });
                            continue;
                        }
                        const type = existing ? { kind: 'array' as const, element: existing.type, rank: existing.rank }
                            : current === undefined ? undefined : compiledArgumentType(current);
                        if (type && typeof type !== 'string' && isNameExpression(part)) {
                            if (!host.arrayReads || type.element === 'real' || type.element === 'bytes'
                                || type.element === 'text' && !host.textArrayLoops
                                || type.element === 'boolean' && !host.booleanArrays) return undefined;
                            const info = existing ?? { slot: slot(part.name), rank: type.rank, type: type.element };
                            arrays.set(part.name, info);
                            calleeArrays.add(part.name);
                            if (!assigned.has(part.name)) arrayInputs.add(part.name);
                            arguments_.push(`r${info.slot}`);
                            types.push({ kind: 'array', element: type.element, rank: type.rank });
                        } else {
                            const value = emit(part, lines, knownType(part));
                            if (!value || value.type === 'bytes' || value.type === 'real') return undefined;
                            arguments_.push(value.code);
                            types.push(value.type);
                        }
                    }
                    const callable = prepareCallee(types);
                    if (callable?.type === 'real') return reject(e, 'unsupported-type:real');
                    if (callable) {
                        const name = `v${serial++}`, index = calls.length;
                        // The proof fixes input domains and permitted mutations.
                        // Binding identity is rechecked at every region entry.
                        calls.push({ name: last.name, locals: callable.locals, stableArrayReads: callable.effects.stableArrayReads, bind: callable.bind });
                        lines.push(`const ${name} = calls[${index}]([${arguments_.join(',')}]${tail ? ', tailCallsAllowed' : ''});`);
                        return { code: name, type: callable.type };
                    }
                }
            }
        }
        if (isApplicationExpression(e)) {
            if (!host.arrayReads) return undefined;
            const [head, ...arguments_] = flattenApplication(e);
            if (!isNameExpression(head) || head.name.includes('.')) return undefined;
            if (!numberMode && host.nativeCalls && host.textLoops && knownType(head) === 'text') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'text'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${serial++}`;
                lines.push(`const ${name} = textRead(${receiver.code}, ${index.code});`);
                return { code: name, type: 'text' };
            }
            if (!numberMode && host.nativeCalls && knownType(head) === 'bytes') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'bytes'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${serial++}`;
                lines.push(`const ${name} = arrayRead(${receiver.code}, [${index.code}]);`);
                return { code: name, type: 'integer' };
            }
            const previous = arrays.get(head.name);
            const type = previous?.type ?? destinations.get(head.name)?.type ?? hint ?? realInput(head.name) ?? 'integer';
            if (type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || type === 'bytes') return undefined;
            if (hint && hint !== type || type === 'boolean' && !host.booleanArrays) return undefined;
            if (previous && previous.rank !== arguments_.length) return undefined;
            const indices: string[] = [];
            for (const argument of arguments_) {
                const value = emit(argument, lines);
                if (value?.type !== 'integer') return undefined;
                indices.push(value.code);
            }
            const info = previous ?? { slot: slot(head.name), rank: indices.length, type };
            arrays.set(head.name, info);
            if (!assigned.has(head.name)) arrayInputs.add(head.name);
            const name = `v${serial++}`;
            if (numberMode) {
                if (info.rank !== 1) return undefined;
                const coordinate = `index${serial++}`;
                lines.push(`const ${coordinate} = ${indices[0]};
                    if (${coordinate} < 0 || ${coordinate} >= cells${info.slot}.length) throw badIndex(${coordinate});
                    const ${name} = cells${info.slot}[${coordinate}];`);
            } else {
                lines.push(`const ${name} = reader${info.slot}(${info.rank === 1 ? indices[0] : `[${indices.join(',')}]`});`);
            }
            return { code: name, type };
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        if (!numberMode && ['in', 'notin'].includes(e.operator) && isNameExpression(e.right)) {
            const name = e.right.name;
            const key = emit(e.left, lines);
            if (key?.type !== 'integer') return undefined;
            const negate = e.operator === 'notin' ? '!' : '';
            if (host.sequenceMembership && !localTypes.has(name) && !arrays.has(name)
                && compiledIntegerMembership(host.read(name))) {
                const index = calls.length;
                calls.push({ name, locals: [], stableArrayReads: true, bind: () => {
                    const domain = host.read(name);
                    if (domain && isRankArray(domain) && (destinations.size || calls.some(call => !call.stableArrayReads))) return undefined;
                    const contains = compiledIntegerMembership(domain);
                    return contains ? arguments_ => contains(arguments_[0] as bigint) : undefined;
                } });
                return { code: `${negate}calls[${index}]([${key.code}])`, type: 'boolean' };
            }
            const receiver = container(name, 'index');
            if (!receiver) return undefined;
            return { code: `${negate}indexHas(${receiver}, key([${key.code}]))`, type: 'boolean' };
        }
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        if (!numberMode && e.operator === '**') {
            let exponent = e.right;
            while (isParenthesizedExpression(exponent)) exponent = exponent.value;
            if (!isNumberLiteral(exponent) || typeof exponent.value !== 'bigint' || exponent.value < 0n) return undefined;
            // Power binds before an unparenthesized sign, as in the evaluator.
            const signed = isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator) ? e.left : undefined;
            const base = emit(signed ? signed.operand : e.left, lines);
            if (!base || !loopOperatorSignature(e.operator, [base.type, 'integer'], host.nativeCalls)) return undefined;
            const name = `v${serial++}`;
            const negative = signed?.operator === '-';
            lines.push(`const ${name} = ${negative ? '-' : ''}((${base.code}) ** ${exponent.value}n);`);
            return { code: name, type: 'integer' };
        }
        return undefined;
    }
    function loopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number): { setup: string; header: string; bindings: string } | undefined {
        return compileLoopParts(node, iteration, location) ?? reject(node, 'loop-header');
    }
    function compileLoopParts(node: ForStatement, iteration: IterationBinding | undefined, location: number) {
        const tests: string[] = [];
        let setup = '', header: string, bindings = '';
        if (iteration) {
            const traversal = loopTraversal(iteration);
            if (!traversal) return undefined;
            const { source: range, indexed, slice } = traversal;
            // Named inputs retain their guarded text/array variants. Pure text
            // expressions are evaluated once in the loop's setup instead.
            const textIteration = host.textLoops && (!isNameExpression(range) && knownType(range) === 'text'
                || isNameExpression(range) && (textSources.has(range.name) || localTypes.get(range.name) === 'text'));
            const collectionIteration = textIteration || isNameExpression(range);
            let elementType: 'integer' | 'text' = textIteration ? 'text' : 'integer';
            if (textIteration) {
                if (slice) return undefined;
                const source = emit(range, tests, 'text');
                if (source?.type !== 'text') return undefined;
                setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source.code}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
            } else if (isNameExpression(range) && host.read(range.name) instanceof RankDeque) {
                // Keep the ordinary live iterator: appended work and front/back
                // operations must have exactly the same order as interpreted BFS.
                if (numberMode || slice || !host.arrayIteration) return undefined;
                const receiver = container(range.name, 'deque', true);
                if (!receiver) return undefined;
                setup = `const iterable = iterators[${iterators.length}](${receiver}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                iterators.push(source => host.iterationValues(iteration, source));
                header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
            } else if (isNameExpression(range)) {
                if (!host.arrayIteration || range.name.includes('.')) return undefined;
                const old = arrays.get(range.name);
                elementType = textArrays.has(range.name) ? 'text' : 'integer';
                if (old && (old.rank !== 1 || old.type !== elementType)) return undefined;
                const info = old ?? { slot: slot(range.name), rank: 1, type: elementType };
                arrays.set(range.name, info);
                if (!assigned.has(range.name)) arrayInputs.add(range.name);
                const binding = iteration;
                const vector = vectorIterations.length;
                if (elementType === 'integer') vectorIterations.push({ slot: info.slot, binding });
                const count = slice ? emit(slice.count, tests, 'integer') : undefined;
                if (slice && (elementType !== 'integer' || count?.type !== 'integer')) return undefined;
                if (numberMode) {
                    if (elementType !== 'integer') return undefined;
                    setup = `${tests.join('\n')} const iterable = cells[${info.slot}];
                        ${slice ? `const count = ${count!.code}; if (count < 0) throw badSlice(${JSON.stringify(slice.drop ? 'drop' : 'take')});` : ''}
                        const offset = ${slice?.drop ? 'Math.min(count, iterable.length)' : '0'};
                        const limit = ${slice && !slice.drop ? 'Math.min(count, iterable.length)' : 'iterable.length'};
                        entered[${vector}] = true; ${indexed ? 'let ordinal = 0;' : ''}`;
                    header = `for (let position = offset; position < limit; position++) {
                        location = ${location}; checkpoint(); const cursor = iterable[position];`;
                } else {
                    const source = slice ? `slice(r${info.slot}, ${count!.code}, ${slice.drop})` : `r${info.slot}`;
                    setup = `${tests.join('\n')} const iterable = iterators[${iterators.length}](${source}); ${indexed ? 'let ordinal = 0n;' : ''}`;
                    iterators.push(source => host.iterationValues(binding, source, elementType));
                    header = `for (const cursor of iterable) { location = ${location}; checkpoint();`;
                }
            } else {
                if (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)) return undefined;
                const start = emit(range.left, tests), end = emit(range.right, tests);
                const step = range.step ? emit(range.step, tests) : { code: one, type: 'integer' };
                if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
                setup = `${tests.join('\n')} const start = ${start.code}, end = ${end.code}, stride = ${step.code};
                    if (stride === ${zero}) throw badStep();`;
                header = `for (let cursor = start${indexed ? `, ordinal = ${zero}` : ''};
                    stride > ${zero} ? cursor ${range.operator === 'to' ? '<=' : '<'} end : cursor ${range.operator === 'to' ? '>=' : '>'} end;
                    cursor = ${safe('cursor + stride')}${indexed ? `, ordinal = ${safe(`ordinal + ${one}`)}` : ''}) { location = ${location}; checkpoint();`;
            }
            for (const [index, name] of iteration.names.entries()) {
                if (name === '#') continue;
                const type = index === 0 ? elementType : 'integer';
                if (localTypes.has(name) && localTypes.get(name) !== type) return undefined;
                localTypes.set(name, type);
                const target = slot(name), value = index === 0 ? 'cursor' : collectionIteration ? 'ordinal++' : 'ordinal';
                bindings += `const bound${binders.length} = ${value}; ${numberMode ? dirty(target) : `binders[${binders.length}](bound${binders.length});`} r${target} = bound${binders.length};\n`;
                binders.push(host.writer(name));
                binderNames.push(name);
                assigned.add(name);
                written.add(name);
            }
        } else {
            const test = node.condition ? emit(node.condition, tests, 'boolean') : { code: 'true', type: 'boolean' };
            if (!test || test.type !== 'boolean') return undefined;
            header = `for (;;) { location = ${location}; checkpoint(); ${tests.join('\n')} if (!(${test.code})) break;`;
        }
        return { setup, header, bindings };
    }
    const root = loopParts(statement, iteration, -1);
    if (!root) return undefined;
    const locations: Statement[] = [];
    function statements(commands: readonly Statement[], body: string[], allowTail: boolean): 'next' | 'stop' | undefined {
        for (const assignment of commands) {
            const location = locations.length;
            // Bound the complete region, including nested branches and loops.
            // Search loops exceed 32 statements even with a small outer body.
            if (location >= 128) return reject(assignment, 'statement-budget');
            locations.push(assignment);
            if (isForStatement(assignment)) {
                if (!host.nestedLoops) return reject(assignment);
                const incoming = new Set(assigned);
                const binding = host.iteration(assignment.condition);
                const loop = loopParts(assignment, binding, location);
                if (!loop) return reject(assignment);
                body.push(`{ let result; location = ${location}; ${loop.setup} ${loop.header}`,
                    'let iterationResult;', loop.bindings);
                if (statements(assignment.statements, body, allowTail && !binding) === undefined) return reject(assignment);
                body.push(`result = iterationResult; location = ${location}; } iterationResult = result; }`);
                // An inner loop may run zero times, or leave through break.
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                continue;
            }
            if (isReturnStatement(assignment)) {
                if (numberMode) return undefined;
                if (!host.returns || !assignment.value) return reject(assignment);
                hasControl = true; hasReturn = true;
                const lines: string[] = [];
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const array = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                let value: string;
                if (array && isNameExpression(expression)) {
                    if (!assigned.has(expression.name)) arrayInputs.add(expression.name);
                    value = `r${array.slot}`;
                } else {
                    const result = emit(expression, lines, undefined, allowTail);
                    if (!result) return reject(assignment);
                    value = result.code;
                }
                body.push(`location = ${location};`, ...lines, `leave(${value});`);
                return 'stop';
            }
            if (isBreakStatement(assignment) || isContinueStatement(assignment)) {
                hasControl = true;
                body.push(`location = ${location}; ${isBreakStatement(assignment) ? 'break' : 'continue'};`);
                return 'stop';
            }
            if (isExpressionStatement(assignment)) {
                const mutation = applicationForm(assignment.value, findOperation, true);
                if (mutation.kind !== 'collection-mutation' || mutation.operation !== 'add'
                    || !isNameExpression(mutation.receiver) || mutation.receiver.name.includes('.') || numberMode) return reject(assignment);
                const operands = mutation.arguments;
                if (!operands || operands.length < 2 || operands.length > 3) return reject(assignment);
                const lines: string[] = [], arguments_: string[] = [];
                for (const operand of operands) {
                    const value = emit(operand, lines, 'integer');
                    if (value?.type !== 'integer') return reject(assignment);
                    arguments_.push(value.code);
                }
                const index = graphMutations.push(mutation.receiver.name) - 1;
                body.push(`location = ${location};`, ...lines,
                    `graphAdds[${index}]([${arguments_.join(',')}]); iterationResult = undefined;`);
                continue;
            }
            if (isPushStatement(assignment)) {
                if (numberMode) return undefined;
                if (!isNameExpression(assignment.receiver)) return reject(assignment);
                const receiver = container(assignment.receiver.name, 'deque');
                const lines: string[] = [];
                const value = emit(assignment.value, lines);
                if (!receiver || value?.type !== 'integer') return reject(assignment);
                needsAlgo = true;
                body.push(`location = ${location};`, ...lines, `${receiver}.push(${value.code}); iterationResult = undefined;`);
                continue;
            }
            if (isArrayAssignmentStatement(assignment)) {
                if (numberMode) return undefined;
                const compound = assignment.operator !== '=';
                const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
                if (compound && (!host.compoundWrites || !findCompiledOperator(assignment.operator.slice(0, -1))?.integerLoop.some(signature => signature.compound))) return reject(assignment);
                if (assignment.name.includes('.')) return reject(assignment);
                const knownArray = arrays.get(assignment.name);
                if (knownArray && knownArray.rank !== assignment.indices.length) return reject(assignment);
                const previous = destinations.get(assignment.name);
                if (previous && previous.rank !== assignment.indices.length) return reject(assignment);
                const target = previous ?? { slot: slot(assignment.name), rank: assignment.indices.length, compound, type: undefined as LoopTerm['type'] | undefined };
                target.compound ||= compound;
                destinations.set(assignment.name, target);
                if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
                const receiver = `storage${target.slot}`;
                const lines: string[] = [], keys: string[] = [];
                for (const address of assignment.indices) {
                    if (address.all || address.sign || !address.value) return reject(assignment);
                    const value = emit(address.value, lines);
                    if (value?.type !== 'integer') return reject(assignment);
                    keys.push(value.code);
                }
                const name = `key${serial++}`;
                if (host.inlineWriteOffsets) {
                    // Shape dimensions are safe integers. Convert each scalar index
                    // once; an out-of-range BigInt cannot round into this range.
                    lines.push(`let ${name}; if (${receiver}.kind === 'array') { ${name} = 0;`);
                    keys.forEach((value, axis) => {
                        const coordinate = `coordinate${serial++}`;
                        lines.push(`const ${coordinate} = Number(${value});
                            if (${value} < 0n || ${coordinate} >= ${receiver}.shape[${axis}]) throw badIndex(${value}, ${axis});
                            ${name} = ${name} * ${receiver}.shape[${axis}] + ${coordinate};`);
                    });
                    lines.push(`} else { ${name} = key([${keys.join(',')}]); }`);
                } else {
                    lines.push(`const ${name} = ${receiver}.kind === 'array'
                        ? arrayOffset(${receiver}, [${keys.join(',')}]) : key([${keys.join(',')}]);`);
                }
                const expected = booleanUpdate ? 'boolean' : compound ? 'integer' : target.type ?? arrays.get(assignment.name)?.type;
                const value = emit(assignment.value, lines, expected);
                if (!value || value.type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || value.type === 'bytes' || value.type === 'boolean' && !host.booleanArrays
                    || expected && value.type !== expected
                    || arrays.has(assignment.name) && arrays.get(assignment.name)!.type !== value.type) return reject(assignment);
                target.type = value.type;
                let result = value.code;
                if (compound) {
                    const rhs = `operand${serial++}`, old = `old${serial++}`;
                    lines.push(`const ${rhs} = ${value.code}, ${old} = ${receiver}.items[${name}];`);
                    const op = assignment.operator.slice(0, -1);
                    const signature = loopOperatorSignature(op, [value.type, value.type], host.nativeCalls);
                    const out = signature?.compound && signature.result === value.type
                        ? arithmetic(op, { code: old, type: value.type }, { code: rhs, type: value.type }, value.type, lines) : undefined;
                    if (out === undefined) return reject(assignment);
                    result = out;
                    body.push(`location = ${location};`, ...lines,
                        `write${target.slot}(${name}, ${result}); iterationResult = ${rhs};`);
                } else {
                    body.push(`location = ${location};`, ...lines, `if (${receiver}.kind === 'array') {
                        write${target.slot}(${name}, ${result}); iterationResult = ${value.code};
                    } else { indexSet(${receiver}, ${name}, ${value.code}); iterationResult = undefined; }`);
                }
                continue;
            }
            if (isIfStatement(assignment)) {
                const incoming = new Set(assigned);
                const outcomes: Set<string>[] = [];
                const branches = [
                    { condition: assignment.condition, statements: assignment.thenStatements },
                    ...assignment.elifClauses,
                ];
                body.push(`location = ${location}; iterationResult = undefined;`);
                for (const branch of branches) {
                    assigned.clear();
                    for (const name of incoming) assigned.add(name);
                    const lines: string[] = [];
                    const condition = emit(branch.condition, lines, 'boolean');
                    if (condition?.type !== 'boolean') return reject(assignment);
                    body.push(`location = ${location};`, ...lines, `if (${condition.code}) {`);
                    const flow = statements(branch.statements, body, allowTail);
                    if (flow === undefined) return reject(assignment);
                    if (flow === 'next') outcomes.push(new Set(assigned));
                    body.push('} else {');
                }
                assigned.clear();
                for (const name of incoming) assigned.add(name);
                const flow = statements(assignment.elseStatements, body, allowTail);
                if (flow === undefined) return reject(assignment);
                if (flow === 'next') outcomes.push(new Set(assigned));
                body.push('}'.repeat(branches.length));
                if (!outcomes.length) return 'stop';
                assigned.clear();
                for (const name of outcomes[0]) {
                    if (outcomes.every(outcome => outcome.has(name))) assigned.add(name);
                }
                continue;
            }
            if (host.arrayLocals && isAssignmentStatement(assignment) && assignment.operator === '='
                && !assignment.name.includes('.')) {
                let expression = assignment.value;
                while (isParenthesizedExpression(expression)) expression = expression.value;
                const source = isNameExpression(expression) ? arrays.get(expression.name) : undefined;
                if (isArrayExpression(expression) || source) {
                    if (localTypes.has(assignment.name)) return reject(assignment);
                    const lines: string[] = [];
                    let rank: number, type: LoopTerm['type'], value: string;
                    if (isArrayExpression(expression)) {
                        if (!expression.dimensions.length || !expression.fill || expression.rows.length) return reject(assignment);
                        const dimensions: string[] = [];
                        for (const item of expression.dimensions) {
                            if (!item.value) return reject(assignment);
                            const size = emit(item.value, lines, 'integer');
                            if (size?.type !== 'integer') return reject(assignment);
                            const name = `dimension${serial++}`;
                            lines.push(`const ${name} = dimension(${item.sign === '-' ? `-(${size.code})` : size.code});`);
                            dimensions.push(name);
                        }
                        const shape = `shape${serial++}`, size = `size${serial++}`;
                        lines.push(`const ${shape} = [${dimensions.join(',')}];`,
                            `const ${size} = ${shape}.reduce((a,b) => a * BigInt(b), 1n);`);
                        const fill = emit(expression.fill, lines);
                        if (!fill || fill.type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || fill.type === 'bytes' || fill.type === 'boolean' && !host.booleanArrays) return reject(assignment);
                        rank = dimensions.length; type = fill.type;
                        value = `created${serial++}`;
                        lines.push(`const ${value} = ownedArray(Array(Number(${size})).fill(${fill.code}), ${shape}, true);`);
                    } else {
                        if (!isNameExpression(expression) || !source) return reject(assignment);
                        const name = expression.name;
                        if (!assigned.has(name)) arrayInputs.add(name);
                        aliases.push([assignment.name, name]);
                        rank = source.rank; type = source.type; value = `r${source.slot}`;
                    }
                    const old = arrays.get(assignment.name), target = destinations.get(assignment.name);
                    if (old && (old.rank !== rank || old.type !== type)
                        || target && (target.rank !== rank || target.type !== type)) return reject(assignment);
                    const destination = slot(assignment.name), index = writers.length;
                    arrays.set(assignment.name, { slot: destination, rank, type });
                    arrayDefinitions.add(assignment.name);
                    written.add(assignment.name);
                    writers.push(host.writer(assignment.name)); writerNames.push(assignment.name);
                    body.push(`location = ${location};`, ...lines,
                        `writers[${index}](${value}); r${destination} = ${value}; storage${destination} = access(${value}); reader${destination} = read(storage${destination}, stableReads, ${rank === 1}); write${destination} = write(storage${destination}, batchWrites); iterationResult = ${value};`);
                    assigned.add(assignment.name);
                    continue;
                }
            }
            const index = writers.length;
            if (!isAssignmentStatement(assignment) || assignment.name.includes('.')) return reject(assignment);
            if (arrays.has(assignment.name)) return reject(assignment);
            const destination = slot(assignment.name);
            written.add(assignment.name);
            if (assignment.operator !== '=' && !assigned.has(assignment.name)) required.add(destination);
            const lines: string[] = [];
            const booleanUpdate = loopOperatorSignature(assignment.operator.slice(0, -1), ['boolean', 'boolean'], host.nativeCalls)?.compound;
            const textUpdate = host.nativeCalls && assignment.operator === '+='
                && (localTypes.get(assignment.name) === 'text' || typeof host.read(assignment.name) === 'string');
            const value = emit(assignment.value, lines, booleanUpdate ? 'boolean' : textUpdate ? 'text' : undefined);
            if (!value || value.type === 'boolean' && !host.booleanLocals) return reject(assignment);
            // A compound update keeps its binding's type, as in `Total += 1`.
            const compound = assignment.operator !== '=';
            const type = localTypes.get(assignment.name)
                ?? (compound ? realInput(assignment.name) : undefined) ?? value.type;
            let result = value.code;
            if (compound) {
                const op = assignment.operator.slice(0, -1);
                const signature = loopOperatorSignature(op, [type, value.type], host.nativeCalls);
                const out = signature?.compound && signature.result === type
                    ? arithmetic(op, { code: `r${destination}`, type }, value, type, lines) : undefined;
                if (out === undefined) return reject(assignment);
                result = out;
            } else if (type !== value.type) return reject(assignment);
            localTypes.set(assignment.name, type);
            writers.push(host.writer(assignment.name));
            writerNames.push(assignment.name);
            body.push(`location = ${location};`, ...lines, `const out${index} = ${result};`,
                `${numberMode ? dirty(destination) : `writers[${index}](out${index});`} r${destination} = out${index}; iterationResult = out${index};`);
            assigned.add(assignment.name);
        }
        return 'next';
    }
    const body: string[] = [];
    if (!statements(statement.statements, body, !iteration)) return undefined;
    // Index aliases can be written under another name. All writes in a region
    // with typed container arguments must preserve their integer cell domain.
    if ([...containers.values()].some(info => info.kind === 'index' && info.integers)
        && [...destinations.values()].some(info => info.type !== 'integer')) return reject(statement, 'container-write-type');
    // Container bindings must remain stable throughout the compiled region.
    if ([...containers].some(([name, info]) => written.has(name) || required.has(info.slot))) return reject(statement, 'unstable-bindings');
    if ([...arrays].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot) || containers.has(name))) return reject(statement, 'unstable-bindings');
    if ([...destinations].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot))) return reject(statement, 'unstable-bindings');
    if ([...builtins.keys()].some(name => written.has(name)) || calls.some(call => written.has(call.name) || call.locals.some(name => written.has(name)))) return reject(statement, 'unstable-bindings');
    if (graphMutations.some(name => written.has(name) || names.includes(name))) return reject(statement, 'unstable-graph');
    const writable = new Set(destinations.keys());
    for (let changed = true; changed;) {
        changed = false;
        for (const [target, source] of aliases) {
            if (writable.has(target) && !writable.has(source)) { writable.add(source); changed = true; }
        }
    }
    // Local text aliases need copy-on-write at the individual store, not just
    // at region entry. Keep those writes interpreted until that lowering exists.
    if (aliases.some(([target, source]) => arrays.get(source)?.type === 'text'
        && (writable.has(target) || writable.has(source)))) return reject(statement, 'unstable-bindings');
    const plan = { statement, names, arrays, destinations, root, body, locations, required, localTypes, containers, builtins, calls, iterators, graphMutations, vectorIterations, writerNames, binderNames, writers, binders, arrayInputs, calleeArrays, hasControl, hasReturn, needsAlgo, arrayDefinitions, writable, iteration };
    return numberMode ? prepareNumberLoop(plan, host) : prepareIntegerLoop(plan, host, () => reject(statement, 'code-generation'));
}
