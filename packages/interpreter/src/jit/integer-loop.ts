import { demandBudgetEnabled } from '../interrupt.js';
import { createLoopState } from './integer-loop-state.js';
import { createLoopExpressions } from './integer-loop-expressions.js';
import { createLoopHeader } from './integer-loop-header.js';
import { createLoopStatements } from './integer-loop-statements.js';
import { prepareNumberLoop } from './number-loop-runtime.js';
import { type IterationBinding, type LoopHost, type CompiledLoop, type IntegerLoopPlan, type LoopWorkFeedback, type LoopPolling } from './integer-loop-plan.js';
import { prepareIntegerLoop } from './integer-loop-runtime.js';
import { wideLoopScalars, wideLoopOutputs, wideLoopBoundary, overflowingLoopOutput, localCallLoopOutput } from './integer-loop-wide.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    isIfStatement, isForStatement, isParenthesizedExpression, isNameExpression, isAssignmentStatement, isArrayAssignmentStatement, statementResultDiscarded, type ForStatement,
    type Statement, type FunctionStatement, isFunctionStatement, isReturnStatement,
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
    // Fresh-array writes and numeric vector reductions can share a private
    // region. External stores keep per-loop transactions and copy feedback.
    const reduction = plan && !plan.destinations.size && !plan.containers.size
        && !plan.callouts?.length && plan.calls.every(call => call.privateStateSafe) && plan.numberVectors
        && plan.builtins.get('sum') === 'core' && plan.locations.some(isForStatement);
    if (!plan || !reduction && (!plan.arrayDefinitions.size || !plan.destinations.size)
        || [...plan.destinations.keys()].some(name => !plan.arrayDefinitions.has(name))) return undefined;
    const terminal = statement.statements.at(-1);
    const returned = isReturnStatement(terminal) && isNameExpression(terminal.value) ? terminal.value.name : undefined;
    const privateReturn = !plan.containers.size && !plan.callouts?.length && plan.calls.every(call => call.privateStateSafe);
    if (privateReturn && returned && (plan.arrayDefinitions.has(returned)
        || reduction && ['integer', 'real'].includes(plan.localTypes.get(returned) ?? ''))
        && statement.statements.some(node => isAssignmentStatement(node) && node.operator === '='
            && !node.deferred && node.name === returned)) {
        // The terminal name is initialized on every successful path. Other
        // private locals cannot escape through this return; still compute and
        // validate their values, but avoid boxing/publishing discarded arrays.
        plan.prefixBindings = new Set([returned, ...statement.parameters,
            ...plan.arrayDefinitions.has(returned) ? [] : plan.rangeDefinitions ?? []]);
    }
    const fast = prepareNumberLoop(plan, host, undefined, undefined,
        polling => lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true, new Set(), false, polling));
    let mixed: CompiledLoop | undefined, preparedMixed = false;
    const straightLine = !plan.locations.some(isForStatement);
    return fast && { run: (...context) => {
        // Ordinary completion and native reductions retain their work units.
        if ((straightLine || reduction || plan.prefixBindings) && demandBudgetEnabled()) return recordFallback('number-loop:observable-prefix-budget', 'effects');
        const result = fast.run(...context);
        if (result) return result;
        if (!preparedMixed) {
            preparedMixed = true;
            mixed = prepareMixedLoops(plan, host, undefined, (wide, counting, polling) =>
                lowerTypedLoop(statement, host, undefined, new Set(), new Set(), () => {}, true, wide, counting, polling));
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
    const exactOutputFirst = numberPlan && (overflowingLoopOutput(numberPlan) || localCallLoopOutput(numberPlan));
    let fast: CompiledLoop | undefined, preparedFast = false;
    const prepareFast = () => {
        if (!preparedFast) {
            preparedFast = true;
            fast = numberPlan && prepareNumberLoop(numberPlan, host, feedback, compileFastCounted,
                polling => lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, new Set(), false, polling));
        }
        return fast;
    };
    // Prefer exact outputs for proven overflow or costly local-storage calls.
    // Budgets or failed mixed entry can still request the Number kernel lazily.
    if (!exactOutputFirst) prepareFast();
    if (!fast && (!numberVariant || !region)) {
        if (!exact && currentDiagnostics()) recordFallback(failure ?? compilerRejection('loop', statement));
        return exact;
    }
    let mixed: CompiledLoop | undefined, preparedMixed = false;
    const prepareMixed = () => {
        if (!preparedMixed) {
            preparedMixed = true;
            mixed = prepareMixedLoops(plan ?? numberPlan!, host, feedback, (wide, counting, polling) =>
                lowerTypedLoop(statement, host, iteration, textSources, textArrays, () => {}, true, wide, counting, polling));
        }
        return mixed;
    };
    return { run: (...context) => {
        if (exactOutputFirst && !demandBudgetEnabled()) {
            const result = prepareMixed()?.run(...context);
            return result ?? prepareFast()?.run(...context) ?? exact?.run(...context);
        }
        const result = prepareFast()?.run(...context);
        if (result) return result;
        if (!fast && demandBudgetEnabled()) return exact?.run(...context);
        return prepareMixed()?.run(...context) ?? exact?.run(...context);
    } };
}

/** Each tier is transactional. Compile broader tiers only if checked
 * intermediate arithmetic or input admission declines a narrower tier; retain exact fallback. */
function prepareMixedLoops(plan: IntegerLoopPlan, host: LoopHost, feedback: LoopWorkFeedback | undefined,
    lower: (wide: ReadonlySet<string>, counting: boolean, polling: LoopPolling) => IntegerLoopPlan | undefined): CompiledLoop | undefined {
    const wide = wideLoopScalars(plan);
    if (!wide.size) return undefined;
    const outputs = wideLoopOutputs(plan, wide);
    const boundary = wideLoopBoundary(plan, wide, outputs);
    const widths = [outputs, boundary, wide].filter((width, index, all) => width.size
        && !all.slice(0, index).some(previous => previous.size === width.size && [...width].every(name => previous.has(name))));
    const variants = widths.map(width => ({ width, compiled: undefined as CompiledLoop | null | undefined }));
    return { run: (...context) => {
        for (const variant of variants) {
            if (variant.compiled === undefined) {
                const candidate = lower(variant.width, false, 'checked');
                variant.compiled = candidate ? prepareNumberLoop(candidate, host, feedback,
                    feedback ? () => lower(variant.width, true, 'checked') : undefined,
                    polling => lower(variant.width, false, polling)) ?? null : null;
            }
            const result = variant.compiled?.run(...context);
            if (result) return result;
        }
        return undefined;
    } };
}

/** Shared region checks and lowering; runtime preparation consumes only the plan. */
function lowerTypedLoop(statement: ForStatement | FunctionStatement, host: LoopHost, iteration: IterationBinding | undefined,
    textSources: ReadonlySet<string>, textArrays: ReadonlySet<string>, failed: (reason: string) => void, numberMode = false,
    wideScalars: ReadonlySet<string> = new Set(), workCounting = false, polling: LoopPolling = 'checked'): IntegerLoopPlan | undefined {
    const state = createLoopState(statement, host, textSources, textArrays, failed, numberMode, wideScalars, workCounting, polling);
    const {
        localTypes, names, required, writers, binders, writerNames, binderNames, written, containers,
        builtins, syntax, calls, arrays, calleeArrays, indexedReads, arrayInputs, arrayDefinitions, aliases,
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
    if ([...builtins.keys(), ...syntax].some(name => written.has(name)) || calls.some(call => written.has(call.name) || call.locals.some(name => written.has(name)))) return reject(statement, 'unstable-bindings');
    if (calls.some(call => call.receiver && (written.has(call.receiver) || names.includes(call.receiver)))) return reject(statement, 'unstable-effect-receiver');
    // An array-returning callee can share a caller operand after entry COW.
    // Per-store ownership preparation is required before these regions may write.
    if (state.hasArrayCall && destinations.size) return reject(statement, 'array-call-write-region');
    // Proven calls cannot retain/observe private bindings. Their entry guards
    // and Number ABI still apply, including current buffers after a move.
    const unsafeCalls = calls.some(call => !call.privateStateSafe);
    const arrayTransfers = new Set(state.arrayTransfers.flat());
    if (arrayTransfers.size) {
        // A completed iteration replaces its prior result. Escaping control or
        // calls could retain/observe a tuple while its arrays are written later.
        if (state.hasControl || unsafeCalls || state.callouts.length) return reject(statement, 'array-transfer-effects');
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
            // A prior result/callback can outlive a binding. Vector allocation
            // instead consults the current register owners before reusing cells.
            if (state.hasControl || unsafeCalls || state.callouts.length)
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
    if (numberMode && aliases.length && unsafeCalls) return reject(statement, 'array-alias-call');
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
    // Managed integer accumulations detach prepared aliases and track dirty
    // rebindings. Other slices/scatters still need their own ownership proof.
    if (numberMode && locations.some(location => isArrayAssignmentStatement(location)
        && arrayDefinitions.has(location.name) && (arrayInputs.has(location.name) || ownedAliases.has(location.name))
        && !(ownedAliases.has(location.name) && state.ownedScatterWrites.has(location))
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
    const marks = (source: string) => source.replace(/\0scatterMark(\d+)\0/g, (_, index) => {
        const { name, slot, key } = state.scatterMarks[Number(index)];
        return arrayDefinitions.has(name) ? arrayInputs.has(name) ? state.dirty(slot) : '' : `changed${slot}[${key}] = 1;`;
    });
    return {
        statement, names, wideScalars, integerRanges: state.integerRanges, rangeNarrowing: state.rangeNarrowing, exactInputs: state.exactInputs, arrays, destinations, root, body: body.map(marks), outlinedLoops: state.outlinedLoops.map(loop => ({ ...loop, body: marks(loop.body) })), locations, required, localTypes, containers,
        retainedLocalArrayResult: state.retainedLocalArrayResult, vectorReductions: state.vectorReductions, primeCopies: state.primeCopies, builtins, syntax, calls, iterators, vectorIterations, writerNames, binderNames, writers,
        binders, arrayInputs, calleeArrays, sliceReadSources: state.sliceReadSources, indexedReads, reversedPrimes: state.reversedPrimes, hasControl: state.hasControl, hasReturn: state.hasReturn, hasYield: state.hasYield,
        ownershipChecks: state.ownershipChecks, ownedAliases, arrayTransfers, arrayRegions: state.arrayRegions, needsAlgo: state.needsAlgo, numberVectors: state.numberVectors, arrayDefinitions, rangeDefinitions: new Set(state.ranges.keys()), writable, iteration, workCounting, polling, callouts: state.callouts,
    };
}
