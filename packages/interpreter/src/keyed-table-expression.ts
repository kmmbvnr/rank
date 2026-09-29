import {
    isKeyedGroupExpression, isKeyedJoinExpression, isKeyedReachExpression,
    isKeyedRollingExpression, type Expression,
} from '@arrrank/language';
import { resume, type Evaluation, type Execution } from './execution.js';
import { RankError } from './errors.js';
import { joinAliasedSqlite, joinSqlite, reachSqlite } from './modules/sqlite.js';
import { groupTable, joinAliasedTables, joinTables, reachTable, rollingTable } from './modules/tables.js';
import { groupColumnar, joinColumnar } from './table-ops.js';
import { isRankArray, isRankSqliteTable, isRankTable, isRankTableAlias, type RankValue } from './value.js';

export interface KeyedTableContext {
    requireModule(module: string, operation: string): void;
    evaluate(expression: Expression): Evaluation<RankValue>;
}

/** Prepare keyed table forms; evaluation remains suspended until requested. */
export function compileKeyedTableExpression(
    expression: Expression, context: KeyedTableContext,
): (() => Evaluation<RankValue>) | undefined {
    if (isKeyedGroupExpression(expression)) {
        return function* (): Execution<RankValue> {
            context.requireModule('tables', expression.operator);
            const source = yield* resume(context.evaluate(expression.source));
            const fields = expression.fields.map(field => field.name);
            if (isRankTable(source)) {
                if (new Set(fields).size !== fields.length) {
                    throw new RankError('group by fields must be unique', 'TypeError');
                }
                return groupColumnar(source, fields, expression.operator === 'rollup by');
            }
            return groupTable(source, fields, expression.operator === 'rollup by');
        };
    }
    if (isKeyedRollingExpression(expression)) {
        return function* (): Execution<RankValue> {
            context.requireModule('tables', 'rolling by');
            const source = yield* resume(context.evaluate(expression.source));
            const width = yield* resume(context.evaluate(expression.width));
            return rollingTable(isRankTable(source) ? source.toRows() : source, width, expression.field.name);
        };
    }
    if (isKeyedJoinExpression(expression)) {
        return function* (): Execution<RankValue> {
            context.requireModule('tables', expression.operator);
            const left = yield* resume(context.evaluate(expression.left));
            const right = yield* resume(context.evaluate(expression.right));
            const mode = expression.operator.startsWith('left') ? 'leftjoin' : 'innerjoin';
            const leftFields = expression.pairs.length > 0
                ? expression.pairs.map(pair => pair.left.name)
                : expression.fields.map(field => field.name);
            const rightFields = expression.pairs.length > 0
                ? expression.pairs.map(pair => pair.right.name)
                : leftFields;
            if (isRankTable(left) && isRankTable(right)) {
                return joinColumnar(left, right, leftFields, mode, rightFields);
            }
            if (isRankTable(left) || isRankTable(right)) {
                throw new RankError(`${mode} expects two tables of the same kind`, 'TypeError');
            }
            if (isRankTableAlias(left) && isRankTableAlias(right)) {
                if (isRankSqliteTable(left.source) && isRankSqliteTable(right.source)) {
                    return joinAliasedSqlite(left.source, right.source, left.name, right.name,
                        leftFields, rightFields, mode);
                }
                if (isRankArray(left.source) && isRankArray(right.source)) {
                    return joinAliasedTables(left.source, right.source, left.name, right.name,
                        leftFields, rightFields, mode);
                }
                throw new RankError(`${mode} expects two aliases of the same table kind`, 'TypeError');
            }
            if (isRankTableAlias(left) || isRankTableAlias(right)) {
                throw new RankError(`${mode} requires aliases on both sides`, 'TypeError');
            }
            if (isRankSqliteTable(left) && isRankSqliteTable(right)) {
                return joinSqlite(left, right, leftFields, rightFields, mode);
            }
            return joinTables(left, right, leftFields, mode, rightFields);
        };
    }
    if (isKeyedReachExpression(expression)) {
        return function* (): Execution<RankValue> {
            context.requireModule('tables', 'reach by');
            const edges = yield* resume(context.evaluate(expression.edges));
            const starts = yield* resume(context.evaluate(expression.starts));
            const from = expression.from.name;
            const to = expression.to.name;
            if (isRankSqliteTable(edges)) return reachSqlite(edges, starts, from, to);
            return reachTable(isRankTable(edges) ? edges.toRows() : edges, starts, from, to);
        };
    }
    return undefined;
}
