import { demandBudgetEnabled } from '../interrupt.js';
import { createLoopState } from './integer-loop-state.js';
import { createLoopExpressions } from './integer-loop-expressions.js';
import { createLoopHeader } from './integer-loop-header.js';
import { createLoopStatements } from './integer-loop-statements.js';
import { prepareNumberLoop } from './number-loop-runtime.js';
import { type IterationBinding, type LoopHost, type CompiledLoop, type IntegerLoopPlan, type LoopWorkFeedback, type LoopPolling } from './integer-loop-plan.js';
import { prepareIntegerLoop } from './integer-loop-runtime.js';
import { wideLoopScalars } from './integer-loop-wide.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    isIfStatement, isForStatement, isParenthesizedExpression, isNameExpression, isAssignmentStatement, isArrayAssignmentStatement, statementResultDiscarded, type ForStatement,
    type Statement, type FunctionStatement, isFunctionStatement,
} from '@arrrank/language';
import { isRankArray } from '../value.js';
import { denseScalarItems, materializedArrayItems, arrayRevision } from '../array-storage.js';

export function compileIntegerLoop(statement: ForStatement, host: LoopHost, iteration?: IterationBinding): CompiledLoop | undefined {
    const diagnostics = currentDiagnostics();
    return diagnostics
        ? diagnostics.measure('loop.prepare', () => prepareIntegerRegion(statement, host, iteration))
        : prepareIntegerRegion(statement, host, iteration);
}

function prepareIntegerRegion(statement: ForStatement, host: LoopHost, iteration?: IterationBinding): CompiledLoop | undefined {
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
            if (variants.size >= 8) return recordFallback('loop:specialization-budget', 'cost');
            variants.set(key, compileTypedLoop(statement, host, iteration, new Set(text), new Set(textArrays)));
        }
        return variants.get(key)?.run(insideFinally, insideGenerator, tailCallsAllowed);
    } };
}

/** A function's numeric prefix uses the loop backend without an artificial loop.
 * Return dispatch remains in the ordinary function body. Failed guards/overflow
 * leave the frame untouched, so the original statements can execute instead. */
export function compileIntegerFunctionPrefix(statement: FunctionStatement, host: LoopHost): CompiledLoop | undefined {
    const plan = lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true);
    // Only fresh-array regions justify joining independent loops. External
    // stores retain their ordinary per-loop transactions and copy-cost feedback.
    if (!plan?.arrayDefinitions.size || plan.destinations.size === 0
        || [...plan.destinations.keys()].some(name => !plan.arrayDefinitions.has(name))) return undefined;
    const fast = prepareNumberLoop(plan, host, undefined, undefined,
        polling => lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true, new Set(), false, polling));
    let mixed: CompiledLoop | undefined, preparedMixed = false;
    return fast && { run: (...context) => {
        const result = fast.run(...context);
        if (result) return result;
        if (!preparedMixed) {
            preparedMixed = true;
            const wide = wideLoopScalars(plan);
            const mixedPlan = wide.size && lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true, wide);
            mixed = mixedPlan ? prepareNumberLoop(mixedPlan, host, undefined, undefined,
                polling => lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true, wide, false, polling)) : undefined;
        }
        return mixed?.run(...context);
    } };
}

function compileTypedLoop(statement: ForStatement, host: LoopHost, iteration: IterationBinding | undefined, textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, numberVariant = false): CompiledLoop | undefined {
    let failure: string | undefined;
    const failed = (reason: string) => { failure ??= reason; };
    const plan = lowerTypedLoop(statement, host, iteration, textSources, textArrays, failed);
    // Replay-safe vector regions may have no publishing exact plan. They still
    // need one bounded copy-cost probe; overflow falls back to interpretation.
    const numberPlan = numberVariant ? lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true) : undefined;
    const region = plan ?? numberPlan;
    const copiesTrees = region && [...region.containers.values()].some(info => info.kind === 'fenwick');
    const feedback: LoopWorkFeedback | undefined = numberVariant && (region?.destinations.size || copiesTrees)
        ? { cells: 0, allow: true } : undefined;
    const compileExactCounted = feedback ? () => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, false, new Set(), true) : undefined;
    const exact = plan && prepareIntegerLoop(plan, host, () => {
        failed(compilerRejection('loop', statement, 'code-generation'));
        return undefined;
    }, feedback, compileExactCounted);
    // A replay-safe backend can support expressions the publishing backend
    // cannot type statically (integer powers may become real for negative exponents).
    const compileFastCounted = feedback ? () => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, new Set(), true) : undefined;
    const fast = numberPlan && prepareNumberLoop(numberPlan, host, feedback, compileFastCounted,
        polling => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, new Set(), false, polling));
    if (!fast && (!numberVariant || !region)) {
        if (!exact && currentDiagnostics()) recordFallback(failure ?? compilerRejection('loop', statement));
        return exact;
    }
    let mixed: CompiledLoop | undefined, preparedMixed = false;
    return { run: (...context) => {
        const result = fast?.run(...context);
        if (result) return result;
        if (!fast && demandBudgetEnabled()) return exact?.run(...context);
        if (!preparedMixed) {
            preparedMixed = true;
            const wide = wideLoopScalars(plan ?? numberPlan!);
            const mixedPlan = wide.size && lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, wide);
            const compileMixedCounted = feedback && wide.size ? () => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, wide, true) : undefined;
            mixed = mixedPlan ? prepareNumberLoop(mixedPlan, host, feedback, compileMixedCounted,
                polling => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, wide, false, polling)) : undefined;
        }
        return mixed?.run(...context) ?? exact?.run(...context);
    } };
}

/** Shared region checks and lowering; runtime preparation consumes only the plan. */
function lowerTypedLoop(statement: ForStatement | FunctionStatement, host: LoopHost, iteration: IterationBinding | undefined,
    textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, failed: (reason: string) => void, numberMode = false,
    wideScalars: ReadonlySet<string> = new Set(), workCounting = false, polling: LoopPolling = 'checked'): IntegerLoopPlan | undefined {
    const state = createLoopState(statement, host, textSources, textArrays, failed, numberMode, wideScalars, workCounting, polling);
    const {
        localTypes, names, required, writers, binders, writerNames, binderNames, written, containers,
        builtins, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases,
        vectorIterations, iterators, destinations, locations, reject,
    } = state;
    if (!statement.statements.length) return reject(statement, 'statement-budget');
    const expressions = createLoopExpressions(state);
    const loopParts = createLoopHeader(state, expressions);
    const region = isFunctionStatement(statement);
    const root = region ? { setup: '', header: '{', bindings: '', breakLabel: undefined }
        : loopParts(statement, iteration, -1, host.continuation);
    if (!root) return undefined;
    const rootScope = numberMode && !region
        ? state.pushScope(root.inductionVariable, root.inductionSlot, root.rangeInfo) : undefined;
    const statements = createLoopStatements(state, expressions, loopParts);
    const body: string[] = [];
    if (!statements(region ? statement.statements.slice(0, -1) : statement.statements, body, !region && !iteration, root.breakLabel)) return undefined;
    if (rootScope) {
        state.popScope();
        if (rootScope.setupLines.length > 0) {
            root.setup = `${root.setup}\n${rootScope.setupLines.join('\n')}`;
        }
    }
    // Container bindings must remain stable throughout the compiled region.
    if ([...containers].some(([name, info]) => written.has(name) || required.has(info.slot))) return reject(statement, 'unstable-bindings');
    if ([...arrays].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot) || containers.has(name))) return reject(statement, 'unstable-bindings');
    if ([...destinations].some(([name, info]) => written.has(name) && !arrayDefinitions.has(name) || required.has(info.slot))) return reject(statement, 'unstable-bindings');
    if ([...builtins.keys()].some(name => written.has(name)) || calls.some(call => written.has(call.name) || call.locals.some(name => written.has(name)))) return reject(statement, 'unstable-bindings');
    if (calls.some(call => call.receiver && (written.has(call.receiver) || names.includes(call.receiver)))) return reject(statement, 'unstable-effect-receiver');
    // An array-returning callee can share a caller operand after entry COW.
    // Per-store ownership preparation is required before these regions may write.
    if (state.hasArrayCall && destinations.size) return reject(statement, 'array-call-write-region');
    const arrayTransfers = new Set(state.arrayTransfers.flat());
    if (arrayTransfers.size) {
        // A completed iteration replaces its prior result. Escaping control or
        // calls could retain/observe a tuple while its arrays are written later.
        if (state.hasControl || calls.length || state.callouts.length) return reject(statement, 'array-transfer-effects');
        const mutable = new Set(destinations.keys());
        for (let size = -1; size !== mutable.size;) {
            size = mutable.size;
            for (const [target, source] of state.arrayTransfers) {
                if (mutable.has(target) || mutable.has(source)) { mutable.add(target); mutable.add(source); }
            }
        }
        for (const name of arrayTransfers) {
            // Read-only permutations need no private numeric buffers. Leave
            // them to ordinary binding rather than copying them speculatively.
            if (!mutable.has(name)) return reject(statement, 'array-transfer-readonly');
            const info = arrays.get(name)!;
            if (!destinations.has(name)) destinations.set(name, { ...info, compound: false });
        }
    }
    // Alias components need binding-level ownership rather than entry-only COW.
    const ownedAliases = new Set<string>();
    if (numberMode && aliases.length) {
        const mutable = new Set(destinations.keys());
        const edges = [...aliases, ...state.arrayTransfers];
        for (let size = -1; size !== mutable.size;) {
            size = mutable.size;
            for (const [target, source] of edges) {
                if (mutable.has(target) || mutable.has(source)) { mutable.add(target); mutable.add(source); }
            }
        }
        for (const [target, source] of aliases) {
            if (mutable.has(target)) { ownedAliases.add(target); ownedAliases.add(source); }
        }
        for (let size = -1; size !== ownedAliases.size;) {
            size = ownedAliases.size;
            for (const [target, source] of edges) {
                if (ownedAliases.has(target) || ownedAliases.has(source)) { ownedAliases.add(target); ownedAliases.add(source); }
            }
        }
        if (ownedAliases.size) {
            // A prior result/callback or pooled vector can outlive a binding.
            // Those owners are not represented by these scalar-store regions.
            if (state.hasControl || calls.length || state.callouts.length || state.numberVectors)
                return reject(statement, 'array-ownership-effects');
            for (const name of ownedAliases) {
                const info = arrays.get(name) ?? destinations.get(name);
                if (!info || info.type !== 'integer' && info.type !== 'real') return reject(statement, 'array-ownership-type');
                arrays.set(name, { ...info, type: info.type });
                destinations.set(name, { ...info, compound: false });
                arrayDefinitions.add(name);
                if (!writerNames.includes(name)) { writerNames.push(name); writers.push(host.writer(name)); }
            }
        }
    }
    const writable = new Set(destinations.keys());
    for (let changed = true; changed;) {
        changed = false;
        for (const [target, source] of aliases) {
            if (writable.has(target) && !writable.has(source)) { writable.add(source); changed = true; }
            if (state.dequeArrays.has(target) && !state.dequeArrays.has(source)) { state.dequeArrays.add(source); changed = true; }
            if (state.dequeArrays.has(source) && !state.dequeArrays.has(target)) { state.dequeArrays.add(target); changed = true; }
        }
    }
    // A deque retains snapshots of pushed arrays. Their local stores need
    // per-statement copy-on-write, beyond the region-entry write guard.
    if ([...state.dequeArrays].some(name => writable.has(name))) return reject(statement, 'deque-array-write');
    // Numeric aliases may share read-only buffers. Mutation or calls require
    // a separate ownership proof. Exact bindings snapshot writable aliases;
    // source stores can still invalidate existing compiled alias readers.
    if (numberMode && aliases.length && calls.length > 0) return reject(statement, 'array-alias-call');
    // Aliases outside the managed components still lack lifetime tracking.
    // Keep their rebound entry arrays on the publishing backend.
    if (numberMode && !ownedAliases.size && aliases.length && [...arrayDefinitions].some(name => arrayInputs.has(name)))
        return reject(statement, 'rebound-array-alias');
    // A previous iteration may retain an array-valued result across a later
    // store/break. Managed ownership excludes early exits; other mutable entry
    // rebindings still need a discarded-result proof.
    const boundary = region ? statement.statements.at(-2) : statement;
    if (numberMode && locations.some(location => isAssignmentStatement(location)
        && arrayDefinitions.has(location.name) && arrayInputs.has(location.name) && destinations.has(location.name)
        && !ownedAliases.has(location.name) && !(boundary && statementResultDiscarded(location, boundary)))) return reject(statement, 'escaping-rebound-array');
    // This ownership path supports scalar cell stores. Slices/scatters need
    // separate dirty/result tracking across replacement and stay on fallback.
    if (numberMode && locations.some(location => isArrayAssignmentStatement(location)
        && arrayDefinitions.has(location.name) && (arrayInputs.has(location.name) || ownedAliases.has(location.name))
        && (location.indices.length !== (arrayTransfers.has(location.name) || ownedAliases.has(location.name) ? arrays.get(location.name)?.rank : 1) || location.indices.some(index => index.all || index.sign
            || !index.value || expressions.knownType(index.value) !== 'integer')))) return reject(statement, 'rebound-array-selection');
    if (aliases.some(([target, source]) => numberMode ? !ownedAliases.has(target) && (writable.has(target) || writable.has(source))
        : destinations.has(source))) return reject(statement, 'mutable-array-alias');
    if (aliases.some(([target, source]) => arrays.get(source)?.type === 'text'
        && (writable.has(target) || writable.has(source)))
        || state.localAliases.some(([target, source]) => !ownedAliases.has(target) && (writable.has(target) || writable.has(source)))) return reject(statement, 'unstable-bindings');
    // A retained slice result can observe later source writes. Discard proofs
    // stop at this region: callers may retain a loop result even when its source
    // program has later statements. Keep live mutable results on the exact path.
    if (numberMode && [...state.sliceResultSources].some(name => writable.has(name))) return reject(statement, 'mutable-slice-result');
    return {
        statement, names, wideScalars, integerRanges: state.integerRanges, rangeNarrowing: state.rangeNarrowing, exactInputs: state.exactInputs, arrays, destinations, root, body, locations, required, localTypes, containers,
        builtins, calls, iterators, vectorIterations, writerNames, binderNames, writers,
        binders, arrayInputs, calleeArrays, sliceReadSources: state.sliceReadSources, indexedReads, hasControl: state.hasControl, hasReturn: state.hasReturn, hasYield: state.hasYield,
        ownershipChecks: state.ownershipChecks, ownedAliases, arrayTransfers, arrayRegions: state.arrayRegions, needsAlgo: state.needsAlgo, numberVectors: state.numberVectors, arrayDefinitions, writable, iteration, workCounting, polling, callouts: state.callouts,
    };
}
