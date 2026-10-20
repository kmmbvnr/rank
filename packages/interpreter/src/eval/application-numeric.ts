import { assertNever, type ApplicationForm } from '@arrrank/language';
import { RankError } from '../errors.js';
import { resume, type Evaluation, type Execution } from '../execution.js';
import { diagonal, diagonalOptions, diagonalShape, matmulValues } from '../modules/linalg.js';
import { shuffleValue } from '../modules/random.js';
import { correlationValue, covarianceValue, errorMetricValue, quantileValue } from '../modules/stats.js';
import { isNativeFunction, type RankValue } from '../value.js';

import type { ApplicationContext } from './application.js';
import type { ModuleApplication } from './application-module.js';

type NumericForm = Extract<ApplicationForm, { kind: 'diagonal' | 'axis-matmul' | 'axis-covariance' | 'axis-correlation' | 'axis-quantile' | 'axis-metric' | 'axis-shuffle' }>;

export function compileNumericApplication(context: ApplicationContext, application: ModuleApplication,
    form: NumericForm): () => Evaluation<RankValue> {
    switch (form.kind) {

        case 'diagonal': {
            return function* (): Execution<RankValue> {
                context.requireModule('linalg', 'diag');
                const source = yield* resume(context.evaluate(form.source));
                const mode = form.mode ? yield* resume(context.evaluate(form.mode)) : undefined;
                const offset = form.offset ? yield* resume(context.evaluate(form.offset)) : undefined;
                const options = diagonalOptions(mode, offset);
                const fn = context.resolve('diag');
                if (!isNativeFunction(fn) || !context.builtins.is('linalg', 'diag', fn)) {
                    throw new RankError('diag parameters require the standard diag', 'TypeError');
                }
                const configured = { ...fn,
                    monadicResultShape: (shape: readonly number[]) => diagonalShape(shape, options.offset),
                    call: (args: RankValue[]) => diagonal(args[0], options.anti, options.offset) };
                return yield* resume(form.rank !== undefined
                    ? application.applyAtRank([source, configured], form.rank, form.axes)
                    : context.rankApplication.applyIntrinsicRank(configured, [source]));
            };
        }

        case 'axis-matmul': {
            const axisMatmul = form;
            return function* (): Execution<RankValue> {
                context.requireModule('linalg', 'matmul');
                return matmulValues(
                    (yield* resume(context.evaluate(axisMatmul.left))),
                    (yield* resume(context.evaluate(axisMatmul.right))),
                    axisMatmul.axes,
                );
            };
        }

        case 'axis-covariance': {
            const axisCovariance = form;
            return function* (): Execution<RankValue> {
                context.requireModule('stats', 'covariance');
                return covarianceValue(
                    (yield* resume(context.evaluate(axisCovariance.source))),
                    axisCovariance.axes,
                );
            };
        }

        case 'axis-correlation': {
            const axisCorrelation = form;
            return function* (): Execution<RankValue> {
                context.requireModule('stats', axisCorrelation.name);
                return correlationValue(
                    (yield* resume(context.evaluate(axisCorrelation.source))),
                    axisCorrelation.axes,
                );
            };
        }

        case 'axis-quantile': {
            const axisQuantile = form;
            return function* (): Execution<RankValue> {
                context.requireModule('stats', axisQuantile.isPercentile ? 'percentile' : 'quantile');
                return quantileValue(
                    (yield* resume(context.evaluate(axisQuantile.source))),
                    (yield* resume(context.evaluate(axisQuantile.q))),
                    axisQuantile.axes,
                    axisQuantile.isPercentile,
                );
            };
        }

        case 'axis-shuffle': {
            const axisShuffle = form;
            return function* (): Execution<RankValue> {
                context.requireModule('random', 'shuffle');
                return shuffleValue(
                    (yield* resume(context.evaluate(axisShuffle.source))),
                    axisShuffle.seed ? (yield* resume(context.evaluate(axisShuffle.seed))) : undefined,
                    axisShuffle.axis,
                    context.random,
                );
            };
        }

        case 'axis-metric': {
            const axisMetric = form;
            return function* (): Execution<RankValue> {
                context.requireModule('stats', axisMetric.metric);
                return errorMetricValue(
                    (yield* resume(context.evaluate(axisMetric.left))),
                    (yield* resume(context.evaluate(axisMetric.right))),
                    axisMetric.metric,
                    axisMetric.axes,
                );
            };
        }
        default: return assertNever(form);
    }
}
