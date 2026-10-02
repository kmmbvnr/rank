import { AstUtils, type AstNode } from 'langium';
import {
    isArrayAssignmentStatement, isAssignmentStatement, isForStatement, isNameExpression, isUnpackStatement,
    type Statement,
} from '@arrrank/language';
import type { BindingEnvironment } from './binding-environment.js';
import { LocalFrame } from './frame.js';
import { debugExecutionPoint, inspectExecution, inspectionEnabled, type PauseSnapshot } from './interrupt.js';
import { sourceIdOf } from './source-location.js';
import { isNativeFunction, isRankArray, isRankSequence, type RankValue } from './value.js';

/**
 * What a paused debugger shows: the statement about to run, the Rank call
 * stack and the bindings each frame holds. Calls report entering and leaving
 * here; nothing is recorded unless inspection is enabled.
 */
export class DebugInspection {
    /** The statement execution last reached. */
    statement?: Statement;
    private readonly calls: { name: string; frame: LocalFrame }[] = [];

    constructor(
        private readonly bindings: BindingEnvironment,
        private readonly sourceId: () => string,
    ) {}

    point(statement: Statement, iteration = false): void {
        if (!inspectionEnabled()) return;
        this.statement = statement;
        this.publish();
        const node = statement.$cstNode;
        if (!node) return;
        const loops: object[] = [];
        for (let parent = statement as AstNode | undefined; parent; parent = parent.$container) {
            if (isForStatement(parent)) loops.unshift(parent);
        }
        debugExecutionPoint({ source: node.root.fullText, line: node.range.start.line + 1,
            loops, depth: this.calls.length, iteration: iteration ? statement : undefined,
            topLevel: statement.$container?.$type === 'Program' });
    }

    /** A call starts running its body in `frame`. */
    enter(name: string, frame: LocalFrame): void {
        this.calls.push({ name, frame });
    }

    /** A tail call reuses the innermost entry for its new frame. */
    replace(name: string, frame: LocalFrame): void {
        this.calls[this.calls.length - 1] = { name, frame };
    }

    /** The innermost call returned or suspended; the caller's statement is current again. */
    leave(caller: Statement | undefined): void {
        this.calls.pop();
        this.statement = caller;
        this.publish();
    }

    private publish(): void {
        inspectExecution(() => this.state());
    }

    private state(): Pick<PauseSnapshot, 'state' | 'bindings'> {
        const inspected: NonNullable<PauseSnapshot['bindings']> = [];
        const reads = new Set<string>();
        const writes = new Map<string, LocalFrame | Map<string, RankValue>>();
        const markWrite = (name: string, mutate: boolean) => {
            if (name.includes('.')) return;
            const frame = this.bindings.current?.find(name);
            const target = mutate ? frame ?? (this.bindings.globals.values.has(name) ? this.bindings.globals.values : undefined)
                : frame ?? this.bindings.current ?? this.bindings.globals.values;
            if (target && target.get(name) !== undefined)
                writes.set(name, target);
        };
        const statement = this.statement;
        if (statement) {
            const visit = (node: AstNode) => {
                if (isNameExpression(node)) reads.add(node.name);
                for (const child of AstUtils.streamContents(node)) {
                    if (!child.$type.endsWith('Statement') && !child.$type.endsWith('Clause')) visit(child);
                }
            };
            visit(statement);
            if ((isAssignmentStatement(statement) && statement.operator !== '=')
                || isArrayAssignmentStatement(statement))
                reads.add(statement.name);
            if (isAssignmentStatement(statement)) markWrite(statement.name, false);
            if (isArrayAssignmentStatement(statement)) markWrite(statement.name, true);
            if (isUnpackStatement(statement))
                for (const name of statement.names) if (name !== '#') markWrite(name, false);
        }
        const node = this.statement?.$cstNode;
        const line = node?.range.start.line;
        const describe = (value: RankValue): string => {
            if (typeof value === 'string') return JSON.stringify(value.slice(0, 200)) + (value.length > 200 ? '…' : '');
            if (value === null || typeof value !== 'object') return String(value);
            if (isRankArray(value)) {
                // A ranked array's shape getter can run a user function. Inspection
                // must not evaluate it, especially while paused inside that function.
                const shape = Object.getOwnPropertyDescriptor(value, 'shape');
                return shape && 'value' in shape ? `<array shape ${shape.value.join(' × ')}>`
                    : '<array shape not evaluated>';
            }
            if (isRankSequence(value)) return `<sequence ${value.plan.name}>`;
            return `<${value.kind}>`;
        };
        const bindings = (scope: LocalFrame | Map<string, RankValue>) => {
            const values = scope instanceof LocalFrame ? scope.values : scope;
            const entries = [...values].filter(([, value]) => !isNativeFunction(value));
            const lines: string[] = [];
            for (const [name, value] of entries) {
                if (lines.length === 100) { lines.push('  …'); break; }
                lines.push(`  ${name} = ${describe(value)}`);
                inspected.push({ name, read: reads.delete(name), write: writes.get(name) === scope });
            }
            return lines.join('\n') || '  (none)';
        };
        const location = node && line !== undefined
            ? `${sourceIdOf(node, this.sourceId())}:${line + 1}\n${node.root.fullText.split(/\r?\n/)[line]}` : '<result preview>';
        const current = this.bindings.current ?? this.bindings.globals.values;
        const seen = new Set<object>([current]);
        const sections = [`Variables (current scope):\n${bindings(current)}`];
        for (const call of [...this.calls].reverse()) {
            if (seen.has(call.frame)) continue;
            seen.add(call.frame);
            sections.push(`${call.name} locals:\n${bindings(call.frame)}`);
        }
        if (!seen.has(this.bindings.globals.values)) sections.push(`Globals:\n${bindings(this.bindings.globals.values)}`);
        return { state: `${location}\n\nCall stack (outermost first):\n<cell>\n${this.calls.map(call => call.name).join('\n')}\n\n${sections.join('\n\n')}`,
            bindings: inspected };
    }
}
