import { inferRequirements, isNameExpression, type CallRequirement, type Expression, type FunctionStatement, type Program, type ValueFacts, type ValueRequirement } from '@arrrank/language';
import { AstUtils } from 'langium';
import { readArrayItem } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { resume, type Evaluation, type Execution } from './execution.js';
import { selectValues } from './value-selection.js';
import { isRankArray, isRankTable, MISSING, typeName, valueRank, type RankValue } from './value.js';

const selectionModules = new Set(['tables']);
type Lengths = Map<number, { length: number; source: string }>;
const callLengths = new WeakMap<CallRequirement, Lengths>();

/** Validate a freshly parsed external value. Requirements remain separate from
 * forward type facts; callers may publish checked facts only after this succeeds.
 * Reader results contain no user callbacks. Do not use this to inspect arbitrary
 * program values or to discover types during static analysis. */
export function checkExternalInput(value: RankValue, requirement: ValueRequirement, source: string,
    equalLengths?: Lengths): void {
    const pending: Lengths = new Map();
    const fail = (path: string, detail: string): never => {
        throw new RankError(`${path}: ${detail}`, 'InputContract');
    };
    const check = (input: RankValue, expected: ValueRequirement, path: string): void => {
        checkpoint('checking external input');
        const rank = valueRank(input);
        if (rank < expected.rank.min || rank > expected.rank.max) {
            const wanted = expected.rank.min === expected.rank.max ? `${expected.rank.min}`
                : expected.rank.max === Infinity ? `at least ${expected.rank.min}`
                    : `${expected.rank.min} to ${expected.rank.max}`;
            fail(path, `expected rank ${wanted}, received rank ${rank}`);
        }
        const shape = isRankArray(input) ? input.shape : isRankTable(input) ? [input.length]
            : typeof input === 'string' ? [[...input].length] : [];
        for (const [axis, length] of expected.dimensions) {
            const actual = shape[axis];
            if (actual === undefined || actual < length.min || actual > length.max) {
                const wanted = length.min === length.max ? `${length.min}`
                    : length.max === Infinity ? `at least ${length.min}` : `${length.min} to ${length.max}`;
                fail(path, `expected axis ${axis} length ${wanted}, received ${actual ?? 'no axis'}`);
            }
            if (length.equality && equalLengths) {
                const { group, offset } = length.equality;
                const previous = pending.get(group) ?? equalLengths.get(group);
                if (previous && actual - offset !== previous.length) {
                    fail(path, `expected axis ${axis} length ${previous.length + offset} as checked at ${previous.source}, received ${actual}`);
                }
                pending.set(group, { length: actual - offset, source: path });
            }
        }
        if (expected.domains) {
            const cell = (item: RankValue, where: string) => {
                const actual = typeName(item);
                if (!expected.domains!.includes(actual)) fail(where,
                    `expected ${expected.domains!.join(' or ') || 'no cells'}, received ${actual}`);
            };
            if (isRankArray(input)) {
                const size = input.shape.reduce((product, length) => product * length, 1);
                for (let index = 0; index < size; index++) {
                    checkpoint('checking external input');
                    cell(readArrayItem(input, index), `${path}[${index}]`);
                }
            } else cell(input, path);
        }
        for (const [name, field] of expected.fields ?? []) {
            const fieldPath = `${path}.${name}`;
            let selected: RankValue;
            try { selected = selectValues(selectionModules, [input, { kind: 'label', name }], () => MISSING); }
            catch (error) {
                if (error instanceof MissingValueError) fail(fieldPath, 'required field is missing');
                if (error instanceof RankError) fail(fieldPath, `cannot select field from ${typeName(input)}`);
                throw error;
            }
            check(selected, field, fieldPath);
        }
    };
    check(value, requirement, source);
    if (equalLengths) for (const [group, length] of pending) equalLengths.set(group, length);
}

/** Requirements are prepared from source once, without inspecting external files.
 * The map belongs to the interpreter and is keyed by the exact parsed expression. */
export class CheckedInputContracts {
    private readonly requirements = new WeakMap<Expression, ValueRequirement>();
    private readonly calls = new WeakMap<Expression, CallRequirement>();
    private readonly scopes = new WeakMap<Expression, Lengths>();
    private enabled = false;
    private frame?: { plan?: CallRequirement; lengths: Lengths; fallback: Lengths };
    pending?: CallRequirement;

    prepare(program: Program, initial: ReadonlyMap<string, ValueFacts>,
        declarations: ReadonlyMap<string, FunctionStatement> = new Map()): void {
        const containsCheck = (source: Program | FunctionStatement) =>
            [...AstUtils.streamAllContents(source)].some(node => isNameExpression(node) && node.name === 'check');
        if (!containsCheck(program) && ![...new Set(declarations.values())].some(containsCheck)) return;
        this.enabled = true;
        const analysis = inferRequirements(program, { initial, declarations, includeCalls: true });
        const lengths: Lengths = new Map();
        for (const [expression, requirement] of analysis.expressions) {
            this.requirements.set(expression, requirement);
            this.scopes.set(expression, lengths);
        }
        for (const [expression, call] of analysis.calls) this.calls.set(expression, call);
        const register = (calls: ReadonlyMap<Expression, CallRequirement>): void => {
            for (const call of calls.values()) { callLengths.set(call, lengths); register(call.calls); }
        };
        register(analysis.calls);
    }

    expression<T>(expression: Expression, run: () => Evaluation<T>): Evaluation<T> {
        if (!this.enabled) return run();
        const previous = this.pending;
        this.pending = this.frame ? this.frame.plan?.calls.get(expression) : this.calls.get(expression);
        return this.scoped(run, () => { this.pending = previous; });
    }

    call<T>(definition: FunctionStatement, plan: CallRequirement | undefined, run: () => Evaluation<T>): Evaluation<T> {
        if (!this.enabled && !plan) return run();
        if (plan) this.enabled = true;
        const previous = this.frame, pending = this.pending;
        const matched = plan?.definition === definition ? plan : undefined;
        this.frame = { plan: matched, lengths: matched && callLengths.get(matched) || new Map(), fallback: new Map() };
        this.pending = undefined;
        return this.scoped(run, () => { this.frame = previous; this.pending = pending; });
    }

    tail(definition: FunctionStatement, plan?: CallRequirement): void {
        if (this.frame) {
            const matched = plan?.definition === definition ? plan : undefined;
            this.frame.plan = matched;
            this.frame.lengths = matched && callLengths.get(matched) || new Map();
            this.frame.fallback = new Map();
        }
        this.pending = undefined;
    }

    private scoped<T>(run: () => Evaluation<T>, restore: () => void): Evaluation<T> {
        let task: Evaluation<T>;
        try { task = run(); } catch (error) { restore(); throw error; }
        if ('done' in task) { restore(); return task; }
        return (function* (): Execution<T> {
            try { return yield* resume(task); } finally { restore(); }
        })();
    }

    check(expression: Expression, value: RankValue, source: string): void {
        const planned = this.frame?.plan?.expressions.get(expression);
        const requirement = planned ?? this.requirements.get(expression);
        if (requirement) checkExternalInput(value, requirement, source,
            this.frame ? planned ? this.frame.lengths : this.frame.fallback : this.scopes.get(expression));
    }
}
