import type { Evaluation } from '../execution.js';
import type { RankValue } from '../value.js';
import type { ApplicationEvaluator } from './application.js';

/** Module forms share core function/rank application without owning dispatch. */
export interface ModuleApplication {
    apply: ApplicationEvaluator['apply'];
    applyAtRank(values: RankValue[], rank: bigint, axes?: readonly number[]): Evaluation<RankValue>;
}
