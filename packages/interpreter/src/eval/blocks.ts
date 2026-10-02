import { AstUtils, type AstNode } from 'langium';
import {
    isAssignmentStatement, isForStatement, isFunctionStatement, isIfStatement, isReturnStatement, isTryStatement,
    isUnpackStatement, type Statement,
} from '@arrrank/language';
import type { BindingEnvironment } from '../binding-environment.js';
import { completed, resume, runExecution, type Evaluation, type Execution } from '../execution.js';
import type { BlockSteps, FastPaths } from '../fast-paths.js';
import type { InterpreterOptions } from '../interpreter-options.js';
import { checkpoint, inspectionEnabled } from '../interrupt.js';
import type { ExecutionContext, LoopControl, PreparedStatement } from '../statement-control.js';
import type { RankValue } from '../value.js';
import type { CompiledBlock } from '../block-compiler.js';
import { forIteration } from './loops.js';

/** What executing blocks needs: statement preparation and the paths that may replace it. */
export interface BlockHost {
    readonly bindings: BindingEnvironment;
    readonly fastPaths: FastPaths;
    prepare(statement: Statement): PreparedStatement;
    /** A debugger stop before a statement. */
    point(statement: Statement): void;
    locate(error: unknown, node: AstNode): unknown;
    /** Names the host binds itself, such as preview flags; they are not block-scoped. */
    syntheticNames(): ReadonlySet<string>;
    options(): InterpreterOptions;
}

/**
 * Running a sequence of statements: preparation on first reach, block scoping
 * of the names a block introduces, suspension and resumption, and error
 * locations. Specialized blocks, function bodies and tensor groups come from
 * the fast-path owner and fall back here.
 */
export class BlockExecution implements BlockSteps {
    private readonly prepared = new WeakMap<Statement, PreparedStatement>();
    private readonly inspected = new WeakMap<Statement, PreparedStatement>();

    constructor(private readonly host: BlockHost) {}

    /** Executes statements under an existing execution context. */
    executeIn(statements: Statement[], context: ExecutionContext): Evaluation<RankValue | undefined> {
        return this.execute(statements, context.assertBooleanExpressions, context.insideLoop, context.insideFinally,
            context.insideGenerator, context.tailCallsAllowed, context.loopControl);
    }

    /** Runs statements to completion; only a top-level program uses this. */
    run(
        statements: Statement[],
        assertBooleanExpressions = false,
        insideLoop = false,
        insideFinally = false,
    ): RankValue | undefined {
        return runExecution(this.execute(
            statements,
            assertBooleanExpressions,
            insideLoop,
            insideFinally,
            false,
        ));
    }

    /**
     * Executes statements in order. A block that completes without suspending
     * answers directly; one that suspends hands its remaining work to the driver.
     */
    execute(
        statements: Statement[],
        assertBooleanExpressions = false,
        insideLoop = false,
        insideFinally = false,
        insideGenerator = false,
        tailCallsAllowed = true,
        loopControl?: LoopControl,
    ): Evaluation<RankValue | undefined> {
        // Ordinary blocks keep their compact context; only protected blocks
        // need to carry the additional tail-call flag.
        const context: ExecutionContext = tailCallsAllowed
            ? { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator, loopControl }
            : { assertBooleanExpressions, insideLoop, insideFinally, insideGenerator, loopControl, tailCallsAllowed: false };
        const block = this.host.fastPaths.block(statements, this);
        if (block) return block(context);
        let result: RankValue | undefined;
        let index = 0;
        try {
            for (; index < statements.length; index += 1) {
                checkpoint();
                const prepared = this.preparedStatement(statements, index);
                if (prepared.tensor && !context.insideFinally && !context.insideGenerator) {
                    const value = prepared.tensor.run();
                    if (value !== undefined) {
                        result = value;
                        index += prepared.tensor.count - 1;
                        continue;
                    }
                }
                if ('run' in prepared) {
                    result = prepared.run(context);
                } else {
                    const task = prepared.stream(context);
                    if ('done' in task) result = task.value;
                    else return this.continueStatementStream(statements, index, context, task);
                }
                if (loopControl?.signal) return completed(result);
            }
        } catch (error) {
            throw this.host.locate(error, statements[index]);
        }
        return completed(result);
    }

    prepareLoopBody(
        statements: Statement[], context: ExecutionContext, iterable: boolean, loopControl?: LoopControl,
    ): () => Evaluation<RankValue | undefined> {
        const block = this.host.fastPaths.block(statements, this);
        const tailCallsAllowed = iterable ? false : context.tailCallsAllowed !== false;
        if (block) {
            const bodyContext: ExecutionContext = tailCallsAllowed
                ? { ...context, insideLoop: true, loopControl }
                : { ...context, insideLoop: true, loopControl, tailCallsAllowed: false };
            return () => block(bodyContext);
        }
        return () => this.execute(statements, context.assertBooleanExpressions,
            true, context.insideFinally, context.insideGenerator, tailCallsAllowed, loopControl);
    }

    /** Resumes a compiled block after the step at `index` suspended. */
    *continueCompiledBlock(
        statements: Statement[], index: number, task: Execution<RankValue | undefined>,
        context: ExecutionContext, block: CompiledBlock<ExecutionContext>,
    ): Execution<RankValue | undefined> {
        try {
            const value = (yield { task }) as RankValue | undefined;
            if (context.loopControl?.signal) return value;
            const next = block(context, index + 1, value);
            return 'done' in next ? next.value : (yield { task: next }) as RankValue | undefined;
        } catch (error) { throw this.host.locate(error, statements[index]); }
    }

    /** A statement prepared once per syntax node; a debugger keeps its own preparations. */
    preparedStatement(statements: Statement[], index: number): PreparedStatement {
        const statement = statements[index];
        this.host.point(statement);
        const cache = inspectionEnabled() ? this.inspected : this.prepared;
        let prepared = cache.get(statement);
        if (!prepared) {
            prepared = this.host.prepare(statement);
            if ((isForStatement(statement) || isIfStatement(statement) || isTryStatement(statement))
                && !insideLoop(statement)) {
                const names = blockNames(statement, this.host.syntheticNames());
                const known = alwaysFresh(statement, names);
                prepared = this.scopeBlock(prepared, [...names.filter(name => known.has(name)),
                    ...names.filter(name => !known.has(name))], known.size);
            }
            if (this.host.options().tensorFusion !== false
                && (isAssignmentStatement(statement) || isReturnStatement(statement))) {
                const tensor = this.host.fastPaths.tensorGroup(statements, index);
                if (tensor) prepared = { ...prepared, tensor };
            }
            cache.set(statement, prepared);
        }
        return prepared;
    }

    // A name a block introduces ends with the block, together with its type.
    // Blocks inside a loop keep theirs until the outermost block ends: every
    // iteration then binds a name with the same type, and the block-scope check
    // has already rejected every read that could see a value kept that long.
    // The first `known` names are provably unbound on entry and skip the lookup.
    private scopeBlock(prepared: PreparedStatement, names: readonly string[], known: number): PreparedStatement {
        if (names.length === 0 || !('stream' in prepared)) return prepared;
        // A bit per name marks the ones this run introduces, without allocating;
        // a block with more names than bits groups them into words.
        if (names.length > 30) {
            let wrapped: PreparedStatement = prepared;
            for (let index = 0; index < names.length; index += 30) {
                wrapped = this.scopeBlock(wrapped, names.slice(index, index + 30),
                    Math.min(30, Math.max(0, known - index)));
            }
            return wrapped;
        }
        const blocks = this;
        const inner = prepared.stream;
        const release = (fresh: number) => {
            for (let index = 0; fresh !== 0; index += 1, fresh >>>= 1) {
                if (fresh & 1) blocks.host.bindings.unbind(names[index]);
            }
        };
        const proven = known === 0 ? 0 : (1 << known) - 1;
        return { ...prepared, stream: context => {
            let fresh = proven;
            for (let index = known; index < names.length; index += 1) {
                if (blocks.host.bindings.find(names[index]) === undefined) fresh |= 1 << index;
            }
            if (fresh === 0) return inner(context);
            let task: Evaluation<RankValue | undefined>;
            try { task = inner(context); } catch (error) { release(fresh); throw error; }
            if ('done' in task) { release(fresh); return task; }
            return (function* (): Execution<RankValue | undefined> {
                try { return yield* resume(task); } finally { release(fresh); }
            })();
        } };
    }

    // Eligibility is prepared with the statement itself. Ordinary scalar
    // statements incur no additional name lookup or optimizer-cache lookup.
    private *continueStatementStream(
        statements: Statement[],
        index: number,
        context: ExecutionContext,
        first: Execution<RankValue | undefined>,
    ): Execution<RankValue | undefined> {
        try {
            let result = yield* resume(first);
            if (context.loopControl?.signal) return result;
            for (index += 1; index < statements.length; index += 1) {
                checkpoint();
                const prepared = this.preparedStatement(statements, index);
                if (prepared.tensor && !context.insideFinally && !context.insideGenerator) {
                    const value = prepared.tensor.run();
                    if (value !== undefined) {
                        result = value;
                        index += prepared.tensor.count - 1;
                        continue;
                    }
                }
                result = 'run' in prepared
                    ? prepared.run(context)
                    : yield* resume(prepared.stream(context));
                if (context.loopControl?.signal) return result;
            }
            return result;
        } catch (error) {
            throw this.host.locate(error, statements[index]);
        }
    }
}

/**
 * Block names no binding outside the block can have set. An assignment inside
 * a top-level function never reaches globals, so a name that is neither a
 * parameter nor bound elsewhere in that function is unbound whenever the block
 * starts. Nested functions and programs share names at runtime and stay checked.
 */
function alwaysFresh(statement: Statement, names: readonly string[]): Set<string> {
    let owner: AstNode | undefined = statement.$container;
    while (owner && !isFunctionStatement(owner)) owner = owner.$container;
    if (!owner || !isFunctionStatement(owner)) return new Set();
    for (let node: AstNode | undefined = owner.$container; node; node = node.$container) {
        if (isFunctionStatement(node)) return new Set();
    }
    const outside = new Set<string>(owner.parameters);
    const visit = (node: AstNode): void => {
        if (node === statement || isFunctionStatement(node)) return;
        if (isAssignmentStatement(node)) outside.add(node.name);
        else if (isUnpackStatement(node)) node.names.forEach(name => outside.add(name));
        else if (isForStatement(node)) forIteration(node.condition)?.names.forEach(name => outside.add(name));
        else if (isTryStatement(node)) node.catches.forEach(clause => outside.add(clause.errorName));
        for (const child of AstUtils.streamContents(node)) visit(child);
    };
    for (const child of AstUtils.streamContents(owner)) visit(child);
    return new Set(names.filter(name => !outside.has(name)));
}

/** Whether a loop of the same function or program encloses the statement. */
function insideLoop(statement: Statement): boolean {
    for (let node = statement.$container; node && !isFunctionStatement(node); node = node.$container) {
        if (isForStatement(node)) return true;
    }
    return false;
}

/** Names a block may introduce: loop bindings, assignments, unpacking and caught errors. */
function blockNames(statement: Statement, syntheticNames: ReadonlySet<string>): string[] {
    const names = new Set<string>();
    const visit = (node: Statement): void => {
        if (isFunctionStatement(node)) return;
        if (isAssignmentStatement(node) && node.operator === '=' && !node.name.includes('.')) names.add(node.name);
        else if (isUnpackStatement(node)) for (const name of node.names) names.add(name);
        else if (isForStatement(node)) {
            for (const name of forIteration(node.condition)?.names ?? []) if (name !== '#') names.add(name);
            node.statements.forEach(visit);
        } else if (isIfStatement(node)) {
            [node.thenStatements, ...node.elifClauses.map(clause => clause.statements), node.elseStatements]
                .forEach(branch => branch.forEach(visit));
        } else if (isTryStatement(node)) {
            node.statements.forEach(visit);
            for (const clause of node.catches) {
                names.add(clause.errorName);
                clause.statements.forEach(visit);
            }
            node.finallyStatements.forEach(visit);
        }
    };
    visit(statement);
    return [...names].filter(name => !syntheticNames.has(name));
}
