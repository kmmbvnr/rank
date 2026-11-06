import {
    applicationForm, flattenApplication, hasPlacedOperands, isApplicationExpression, isAssignmentStatement, isBinaryExpression, isDeclaredCallExpression, isNameExpression,
    isNumberLiteral, isParenthesizedExpression, isUnaryExpression, isUnpackStatement,
    type Expression, type ForStatement, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { completed } from '../execution.js';
import { InterruptedError, interruptsEnabled, privateLoopPolling } from '../interrupt.js';
import { RankError } from '../errors.js';
import { currentDiagnostics } from '../diagnostics.js';
import { floorDivide, floorRemainder } from '../numeric-division.js';
import { typedArray } from '../array-storage.js';
import { tuple, type RankArray, type RankValue } from '../value.js';
import { borrowNumericBuffer, compileNumericFunction, NumericBuffer } from './numeric-function.js';
import type { CompiledLoop } from './integer-loop-plan.js';

type Value = RankValue | NumericBuffer;
type Variables = Map<string, Value>;
type Scalar = (values: Variables) => bigint | undefined;
interface Host {
    read(name: string): RankValue | undefined;
    callee(name: string): { identity: RankValue; statement: FunctionStatement; available(): boolean;
        check(arguments_: RankValue[], result: RankValue): void } | undefined;
    builtin(name: 'len' | 'reshape' | 'concat'): boolean;
    enabled(): boolean;
    canDeferWrites(bindings: readonly [string, 'integer' | 'array', number?][]): boolean;
    commit(name: string, statement: Statement, value: RankValue): void;
}
const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;
const integer = (v: Value | undefined): v is bigint => typeof v === 'bigint' && Number.isSafeInteger(Number(v));
const comparisons = new Set(['equal', 'notequal', 'less', 'greater', 'atmost', 'atleast']);
const arithmetic = new Set(['+', '-', '*', '//', 'mod']);
function calculate(op: string, a: bigint, b: bigint): bigint | undefined {
    if ((op === '//' || op === 'mod') && b === 0n) return undefined;
    const value = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b
        : op === '//' ? floorDivide(a, b) : floorRemainder(a, b);
    return integer(value) ? value : undefined;
}

/** A pure callee protocol, not an FFT recognizer. All registers are private
 * until success; any declined guard replays the unchanged ordinary loop.
 * Entry arrays are borrowed read-only. No private buffer escapes on failure. */
export function compileNumericCallLoop(statement: ForStatement, host: Host): CompiledLoop | undefined {
    if (!statement.condition || statement.statements.length > 16) return undefined;
    const scalarReads = new Set<string>(), reads = new Set<string>();
    const arrayWrites = new Set<string>(), scalarWrites = new Set<string>();
    let budget = 256;
    function scalar(expression: Expression): Scalar | undefined {
        if (--budget < 0) return undefined;
        const e = unwrap(expression);
        if (isNumberLiteral(e) && integer(e.value)) return () => e.value as bigint;
        if (isNameExpression(e) && !e.name.includes('.')) {
            scalarReads.add(e.name); reads.add(e.name);
            return values => { const value = values.get(e.name); return integer(value) ? value : undefined; };
        }
        if (isUnaryExpression(e) && ['+', '-'].includes(e.operator)) {
            const operand = scalar(e.operand);
            return operand && (values => { const value = operand(values); return value === undefined ? undefined : e.operator === '-' ? -value : value; });
        }
        if (isBinaryExpression(e) && !e.step && arithmetic.has(e.operator)) {
            const left = scalar(e.left), right = scalar(e.right);
            return left && right && (values => {
                const a = left(values), b = right(values);
                return a === undefined || b === undefined ? undefined : calculate(e.operator, a, b);
            });
        }
        return undefined;
    }
    const condition = unwrap(statement.condition);
    if (!isBinaryExpression(condition) || condition.step || !comparisons.has(condition.operator)) return undefined;
    const left = scalar(condition.left), right = scalar(condition.right);
    if (!left || !right) return undefined;
    const test = (values: Variables): boolean | undefined => {
        const a = left(values), b = right(values);
        if (a === undefined || b === undefined) return undefined;
        return condition.operator === 'equal' ? a === b : condition.operator === 'notequal' ? a !== b
            : condition.operator === 'less' ? a < b : condition.operator === 'greater' ? a > b
                : condition.operator === 'atmost' ? a <= b : a >= b;
    };
    type Update = { name: string; statement: Statement; evaluate: Scalar };
    type Call = { statement: Statement; targets: string[]; tuple: boolean; name: string; identity: RankValue; available(): boolean;
        check(arguments_: RankValue[], result: RankValue): void;
        run(values: Variables): { output: NumericBuffer[]; arguments_: Value[] } | undefined };
    const steps: (Update | Call)[] = [], calls: Call[] = [];
    function helperCall(expression: Expression) {
        if (isDeclaredCallExpression(expression) && !expression.ranks.length && !expression.axes.length
            && isNameExpression(expression.callee)) {
            const name = expression.callee.name, callee = host.callee(name);
            return callee && { name, callee, arguments_: expression.arguments };
        }
        if (isApplicationExpression(expression) && applicationForm(expression).kind === 'plain') {
            const parts = flattenApplication(expression);
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!isNameExpression(part)) continue;
                const callee = host.callee(part.name);
                if (callee && (hasPlacedOperands(part) ? i === parts.length - 1 : callee.statement.leftParameters.length === i)
                    && callee.statement.parameters.length === parts.length - 1) {
                    return { name: part.name, callee, arguments_: [...parts.slice(0, i), ...parts.slice(i + 1)] };
                }
            }
        }
        return undefined;
    }
    for (const command of statement.statements) {
        const assignment = isAssignmentStatement(command), unpack = isUnpackStatement(command);
        if (!assignment && !unpack || assignment && (command.deferred || command.name.includes('.'))) return undefined;
        const expression = unwrap(command.value);
        const helper = helperCall(expression);
        if (helper && (!assignment || command.operator === '=')) {
            const { name, callee, arguments_ } = helper;
            if (!callee || callee.statement.memo || callee.statement.groups.length
                || callee.statement.parameters.some(name => !/^[A-Z]/.test(name))
                || callee.statement.parameters.length !== arguments_.length) return undefined;
            const targets = unpack ? command.names : [command.name];
            if (new Set(targets).size !== targets.length || targets.some(n => n === '#' || n.includes('.'))) return undefined;
            const args: ((values: Variables) => Value | undefined)[] = [];
            for (const argument of arguments_) {
                const e = unwrap(argument);
                if (isNameExpression(e) && !e.name.includes('.')) { reads.add(e.name); args.push(values => values.get(e.name)); }
                else {
                    const literal = isUnaryExpression(e) && ['+', '-'].includes(e.operator) ? unwrap(e.operand) : e;
                    if (!isNumberLiteral(literal)) return undefined;
                    const value = isUnaryExpression(e) && e.operator === '-' ? -literal.value : literal.value;
                    if (!integer(value) && !(typeof value === 'number' && Number.isFinite(value))) return undefined;
                    args.push(() => value);
                }
            }
            let active: Variables | undefined;
            const plan = compileNumericFunction(callee.statement, {
                lookup: name => { const value = active?.get(name); return value instanceof NumericBuffer ? undefined : value; },
                buffer: name => { const value = active?.get(name); return value instanceof NumericBuffer ? value : undefined; },
                builtin: host.builtin, compiled: () => {}, executed: () => {},
            });
            if (!plan || plan.tupleResult !== unpack || plan.resultCount !== targets.length) return undefined;
            const call: Call = { statement: command, targets, tuple: unpack, name, identity: callee.identity,
                available: callee.available, check: callee.check,
                run: values => {
                    active = new Map();
                    try {
                        const arguments_: Value[] = [];
                        for (let i = 0; i < args.length; i++) {
                            const value = args[i](values); if (value === undefined) return undefined;
                            arguments_.push(value);
                            active.set(callee.statement.parameters[i], value);
                        }
                        const output = plan.runBuffers();
                        return output && { output, arguments_ };
                    } finally { active = undefined; }
                },
            };
            targets.forEach(n => arrayWrites.add(n)); calls.push(call); steps.push(call);
        } else if (assignment) {
            const value = scalar(command.value), op = command.operator.slice(0, -1);
            if (!value || command.operator !== '=' && !arithmetic.has(op)) return undefined;
            scalarWrites.add(command.name); scalarReads.add(command.name); reads.add(command.name);
            steps.push({ name: command.name, statement: command, evaluate: values => {
                const b = value(values); if (b === undefined || command.operator === '=') return b;
                const a = values.get(command.name); return integer(a) ? calculate(op, a, b) : undefined;
            } });
        } else return undefined;
    }
    if (!calls.length || [...arrayWrites].some(n => scalarReads.has(n) || scalarWrites.has(n))) return undefined;
    arrayWrites.forEach(n => reads.add(n));
    return { run(insideFinally = false, insideGenerator = false) {
        if (insideFinally || insideGenerator || !host.enabled() || !privateLoopPolling() || interruptsEnabled()) return undefined;
        let publishing = false;
        try {
            const control: Variables = new Map();
            for (const name of scalarReads) { const value = host.read(name); if (!integer(value)) return undefined; control.set(name, value); }
            // Scalar control has no dependency on array results. Prove a bounded
            // schedule before performing any speculative numerical work.
            let iterations = 0;
            for (;;) {
                const more = test(control); if (more === undefined) return undefined; if (!more) break;
                if (++iterations > 1024) return undefined;
                for (const step of steps) if ('evaluate' in step) {
                    const value = step.evaluate(control); if (value === undefined) return undefined;
                    control.set(step.name, value);
                }
            }
            if (!iterations) return completed(undefined);
            for (const call of calls) if (host.read(call.name) !== call.identity || !call.available()) return undefined;
            const values: Variables = new Map(), ranks = new Map<string, number>();
            const materialized = new Map<NumericBuffer, RankArray>();
            for (const name of reads) {
                const value = host.read(name);
                if (integer(value) || typeof value === 'number' && Number.isFinite(value)) values.set(name, value);
                else {
                    const buffer = borrowNumericBuffer(value); if (!buffer || buffer.integer) return undefined;
                    materialized.set(buffer, value as RankArray);
                    values.set(name, buffer);
                }
            }
            for (const name of arrayWrites) {
                const value = values.get(name); if (!(value instanceof NumericBuffer)) return undefined;
                ranks.set(name, value.shape.length);
            }
            if (!host.canDeferWrites([...arrayWrites].map(name => [name, 'array', ranks.get(name)]))
                || !host.canDeferWrites([...scalarWrites].map(name => [name, 'integer']))) return undefined;
            const dirty = new Map<string, Statement>();
            const observations: [Call, { output: NumericBuffer[]; arguments_: Value[] }][] = [];
            let result: Value | NumericBuffer[] | undefined, tupleResult = false;
            for (let i = 0; i < iterations; i++) for (const step of steps) {
                if ('evaluate' in step) {
                    const value = step.evaluate(values); if (value === undefined) return undefined;
                    values.set(step.name, value); dirty.set(step.name, step.statement); result = value; tupleResult = false;
                } else {
                    const call = step.run(values); if (!call) return undefined;
                    const { output } = call;
                    if (output.some(value => value.integer || !value.shape.length)) return undefined;
                    for (let j = 0; j < output.length; j++) if (output[j].shape.length !== ranks.get(step.targets[j])) return undefined;
                    if (i < 2) observations.push([step, call]);
                    output.forEach((value, j) => { values.set(step.targets[j], value); dirty.set(step.targets[j], step.statement); });
                    result = step.tuple ? output : output[0]; tupleResult = step.tuple;
                }
            }
            const materialize = (value: Value): RankValue => {
                if (!(value instanceof NumericBuffer)) return value;
                let array = materialized.get(value);
                if (!array) {
                    array = typedArray(value.cells instanceof Float64Array ? value.cells : Float64Array.from(value.cells), value.shape, undefined, 'real');
                    materialized.set(value, array);
                }
                return array;
            };
            // Retain ordinary public return contracts and observed rank facts.
            // The first pass may consume unresolved input declarations. By the
            // second, all loop-written arrays are real with fixed ranks. Later
            // shapes/scalars do not change argument specialization signatures.
            for (const [call, observation] of observations) {
                const result = call.tuple ? tuple(observation.output.map(materialize)) : materialize(observation.output[0]);
                call.check(observation.arguments_.map(materialize), result);
            }
            const stores = [...dirty].map(([name, source]) => ({ name, source, value: materialize(values.get(name)!) }));
            const returned = tupleResult ? tuple((result as NumericBuffer[]).map(materialize))
                : result === undefined ? undefined : materialize(result as Value);
            publishing = true;
            for (const store of stores) host.commit(store.name, store.source, store.value);
            const diagnostics = currentDiagnostics();
            if (diagnostics) { diagnostics.compiledNumericCallLoops++; diagnostics.numericLoopCalls += iterations * calls.length; diagnostics.compiledArrayFunctions += iterations * calls.length; }
            return completed(returned);
        } catch (error) {
            if (!publishing && error instanceof RankError && !(error instanceof InterruptedError)) return undefined;
            throw error;
        }
    } };
}
