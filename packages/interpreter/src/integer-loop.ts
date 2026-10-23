import { createLoopState } from './integer-loop-state.js';
import { createLoopExpressions } from './integer-loop-expressions.js';
import { createLoopHeader } from './integer-loop-header.js';
import { createLoopStatements } from './integer-loop-statements.js';
import { prepareNumberLoop } from './number-loop-runtime.js';
import { type IterationBinding, type LoopHost, type CompiledLoop, type IntegerLoopPlan } from './integer-loop-plan.js';
import { prepareIntegerLoop } from './integer-loop-runtime.js';
import { wideLoopScalars } from './integer-loop-wide.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    isIfStatement, isForStatement, isParenthesizedExpression, isNameExpression, type ForStatement,
    type Statement,
} from '@arrrank/language';
import { isRankArray } from './value.js';
import { denseScalarItems, materializedArrayItems, arrayRevision } from './array-storage.js';

export function compileIntegerLoop(statement: ForStatement, host: LoopHost, iteration?: IterationBinding): CompiledLoop | undefined {
    const sources: string[] = [];
    const numericHost = host.compiled ? { ...host, compiled: (source: string) => sources.push(source) } : host;
    const numeric = compileTypedLoop(statement, numericHost, iteration, new Set(), new Set(), true);
    if (sources.length) host.compiled?.(sources.join('\n'));
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
                const items = denseScalarItems(value) ?? materializedArrayItems(value);
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

function compileTypedLoop(statement: ForStatement, host: LoopHost, iteration: IterationBinding | undefined, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, numberVariant = false): CompiledLoop | undefined {
    let failure: string | undefined;
    const failed = (reason: string) => { failure ??= reason; };
    const plan = lowerTypedLoop(statement, host, iteration, textSources, textArrays, failed);
    const exact = plan && prepareIntegerLoop(plan, host, () => {
        failed(compilerRejection('loop', statement, 'code-generation'));
        return undefined;
    });
    // A replay-safe backend can support expressions the publishing backend
    // cannot type statically (integer powers may become real for negative exponents).
    const numberPlan = numberVariant && lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true);
    const fast = numberPlan && prepareNumberLoop(numberPlan, host);
    if (!fast) {
        if (!exact && currentDiagnostics()) recordFallback(failure ?? compilerRejection('loop', statement));
        return exact;
    }
    let mixed: CompiledLoop | undefined, preparedMixed = false;
    return { run: (...context) => {
        const result = fast.run(...context);
        if (result) return result;
        if (!preparedMixed) {
            preparedMixed = true;
            const wide = wideLoopScalars(plan ?? numberPlan!);
            const mixedPlan = wide.size && lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, wide);
            mixed = mixedPlan ? prepareNumberLoop(mixedPlan, host) : undefined;
        }
        return mixed?.run(...context) ?? exact?.run(...context);
    } };
}

/** Shared region checks and lowering; runtime preparation consumes only the plan. */
function lowerTypedLoop(statement: ForStatement, host: LoopHost, iteration: IterationBinding | undefined,
    textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, failed: (reason: string) => void, numberMode = false,
    wideScalars: ReadonlySet<string> = new Set()): IntegerLoopPlan | undefined {
    const state = createLoopState(host, textSources, textArrays, failed, numberMode, wideScalars);
    const {
        localTypes, names, required, writers, binders, writerNames, binderNames, written, containers,
        builtins, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases,
        vectorIterations, iterators, destinations, locations, reject,
    } = state;
    if (!statement.statements.length) return reject(statement, 'statement-budget');
    const expressions = createLoopExpressions(state);
    const loopParts = createLoopHeader(state, expressions);
    const root = loopParts(statement, iteration, -1);
    if (!root) return undefined;
    const statements = createLoopStatements(state, expressions, loopParts);
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
    if (calls.some(call => call.receiver && (written.has(call.receiver) || names.includes(call.receiver)))) return reject(statement, 'unstable-effect-receiver');
    // An array-returning callee can share a caller operand after entry COW.
    // Per-store ownership preparation is required before these regions may write.
    if (state.hasArrayCall && destinations.size) return reject(statement, 'array-call-write-region');
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
    return {
        statement, names, wideScalars, arrays, destinations, root, body, locations, required, localTypes, containers,
        builtins, calls, iterators, vectorIterations, writerNames, binderNames, writers,
        binders, arrayInputs, calleeArrays, indexedReads, hasControl: state.hasControl, hasReturn: state.hasReturn, hasYield: state.hasYield,
        needsAlgo: state.needsAlgo, arrayDefinitions, writable, iteration,
    };
}
