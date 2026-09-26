import { checkpoint, interruptibleCallback } from '../interrupt.js';
import { derivedArray, arrayRevision, ownedArray, readArrayItem } from '../array-storage.js';
import { MissingValueError, RankError } from '../errors.js';
import { numericSource, sequenceValues } from '../sequence.js';
import { mapBroadcastArrays } from '../tensor.js';
import {
    isRankArray,
    isRankSequence,
    type RankArray,
    type RankValue,
} from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const statsModule: RuntimeModule = {
    mean: () => native('mean', 1, ([value]) => meanValue(numericSource(value))),
    median: () => native('median', 1, ([value]) => medianValue(numericSource(value))),
    std: () => native('std', 1, ([value]) => standardDeviation(numericSource(value))),
    variance: () => native('variance', 1, ([value]) => varianceValue(numericSource(value))),
    var: () => native('var', 1, ([value]) => varianceValue(numericSource(value))),
    quantile: () => native('quantile', [1, 2], args => quantileValue(numericSource(args[0]), args[1] ?? 0.5), 'all', [1, 0]),
    percentile: () => native('percentile', [1, 2], args => quantileValue(numericSource(args[0]), args[1] ?? 50, undefined, true), 'all', [1, 0]),
    skewness: () => native('skewness', 1, ([value]) => skewnessValue(numericSource(value))),
    skew: () => native('skew', 1, ([value]) => skewnessValue(numericSource(value))),
    mode: () => native('mode', 1, ([value]) => modeValue(value)),
    mse: () => native('mse', 2, arguments_ => errorMetricValue(
        arguments_[0],
        arguments_[1],
        'mse',
    )),
    mae: () => native('mae', 2, arguments_ => errorMetricValue(
        arguments_[0],
        arguments_[1],
        'mae',
    )),
    covariance: () => native(
        'covariance',
        1,
        arguments_ => covarianceValue(arguments_[0]),
    ),
    correlation: () => native(
        'correlation',
        1,
        arguments_ => correlationValue(arguments_[0]),
    ),
    corr: () => native(
        'corr',
        1,
        arguments_ => correlationValue(arguments_[0]),
    ),
};

export function errorMetricValue(
    left: RankValue,
    right: RankValue,
    metric: 'mse' | 'mae',
    axes?: readonly number[],
): RankValue {
    const losses = mapBroadcastArrays(
        metricArray(left, metric),
        metricArray(right, metric),
        (a, b) => {
            const difference = Number(expectNumeric(a)) - Number(expectNumeric(b));
            return metric === 'mse' ? difference * difference : Math.abs(difference);
        },
    );
    return axes === undefined
        ? metricMean(losses, metric)
        : metricByAxes(losses, axes, metric);
}

function metricMean(losses: RankArray, metric: 'mse' | 'mae'): number {
    if (arraySize(losses.shape) === 0) {
        throw new RankError(`${metric} requires at least one value`, 'EmptyReduction');
    }
    return meanValue(losses);
}

function metricArray(value: RankValue, operation: string): RankArray {
    if (isRankArray(value)) return value;
    const items = [...sequenceValues(value, operation)];
    return ownedArray(items, isRankSequence(value) ? [items.length] : []);
}

function metricByAxes(
    losses: RankArray,
    axes: readonly number[],
    metric: 'mse' | 'mae',
): RankValue {
    for (const axis of axes) {
        checkpoint('computing statistics');
        if (axis >= losses.shape.length) {
            throw new RankError(`array has no axis ${axis}`);
        }
    }
    if (new Set(axes).size !== axes.length) {
        throw new RankError(`${metric} axes must be unique`);
    }

    const selected = new Set(axes);
    const reducedAxes = losses.shape
        .map((_, axis) => axis)
        .filter(axis => selected.has(axis));
    const frameAxes = losses.shape
        .map((_, axis) => axis)
        .filter(axis => !selected.has(axis));
    const reducedShape = reducedAxes.map(axis => losses.shape[axis]);
    const frameShape = frameAxes.map(axis => losses.shape[axis]);
    const reducedSize = arraySize(reducedShape);

    const valueAt = (frameIndex: number): number => {
        if (reducedSize === 0) {
            throw new RankError(`${metric} requires at least one value`, 'EmptyReduction');
        }
        const source = Array(losses.shape.length).fill(0) as number[];
        coordinatesAt(frameShape, frameIndex).forEach((coordinate, index) => {
            source[frameAxes[index]] = coordinate;
        });
        let total = 0;
        for (let index = 0; index < reducedSize; index += 1) {
            checkpoint('computing statistics');
            coordinatesAt(reducedShape, index).forEach((coordinate, position) => {
                source[reducedAxes[position]] = coordinate;
            });
            total += Number(arrayItem(losses, arrayOffset(losses.shape, source)));
        }
        return total / reducedSize;
    };

    return frameShape.length === 0
        ? valueAt(0)
        : derivedArray(frameShape, [losses], valueAt, true);
}

/** Fuse cell reads with statistics while deferring validation until every
 * source read succeeds, as the ordinary gather-then-reduce path requires. */
export function statisticsCell(
    operation: 'mean' | 'std', size: number, itemAt: (index: number) => RankValue,
): number {
    let total = 0, count = 0;
    const values = operation === 'std' ? [] as number[] : undefined;
    let invalid: { value: RankValue; nonfinite: boolean } | undefined;
    for (let index = 0; index < size; index++) {
        checkpoint('computing statistics');
        let value: RankValue;
        try { value = itemAt(index); }
        catch (error) {
            if (error instanceof MissingValueError) continue;
            throw error;
        }
        count++;
        if (typeof value !== 'number' && typeof value !== 'bigint') {
            invalid ??= { value, nonfinite: false };
            continue;
        }
        const numeric = Number(value);
        if (operation === 'std' && !Number.isFinite(numeric)) {
            invalid ??= { value, nonfinite: true };
        }
        total += numeric;
        values?.push(numeric);
    }
    if (count === 0) throw new RankError(`${operation} requires at least one value`, 'EmptyReduction');
    if (invalid) {
        if (invalid.nonfinite) throw new RankError('std expects finite values', 'DomainError');
        expectNumeric(invalid.value);
    }
    const mean = total / count;
    if (!values) return mean;
    let squared = 0;
    for (const value of values) {
        checkpoint('computing statistics');
        const difference = value - mean;
        squared += difference * difference;
    }
    return Math.sqrt(squared / count);
}

export function standardDeviation(value: RankValue): number {
    const items = presentValues(value, 'std');
    if (items.length === 0) {
        throw new RankError('std requires at least one value', 'EmptyReduction');
    }
    const values = items.map(item => {
        const numeric = Number(expectNumeric(item));
        if (!Number.isFinite(numeric)) {
            throw new RankError('std expects finite values', 'DomainError');
        }
        return numeric;
    });
    const mean = values.reduce((total, item) => total + item, 0) / values.length;
    const squared = values.reduce((total, item) => {
        const difference = item - mean;
        return total + difference * difference;
    }, 0);
    return Math.sqrt(squared / values.length);
}

export function varianceValue(value: RankValue): number {
    const items = presentValues(value, 'variance');
    if (items.length === 0) {
        throw new RankError('variance requires at least one value', 'EmptyReduction');
    }
    const values = items.map(item => {
        const numeric = Number(expectNumeric(item));
        if (!Number.isFinite(numeric)) {
            throw new RankError('variance expects finite values', 'DomainError');
        }
        return numeric;
    });
    const mean = values.reduce((total, item) => total + item, 0) / values.length;
    const squared = values.reduce((total, item) => {
        const difference = item - mean;
        return total + difference * difference;
    }, 0);
    return squared / values.length;
}

export function skewnessValue(value: RankValue): number {
    const items = presentValues(value, 'skewness');
    if (items.length === 0) {
        throw new RankError('skewness requires at least one value', 'EmptyReduction');
    }
    const values = items.map(item => {
        const numeric = Number(expectNumeric(item));
        if (!Number.isFinite(numeric)) {
            throw new RankError('skewness expects finite values', 'DomainError');
        }
        return numeric;
    });
    const n = values.length;
    const mean = values.reduce((total, item) => total + item, 0) / n;
    const variance = values.reduce((total, item) => {
        const diff = item - mean;
        return total + diff * diff;
    }, 0) / n;
    const std = Math.sqrt(variance);
    if (std === 0 || n < 3) return 0;
    const m3 = values.reduce((total, item) => {
        const diff = item - mean;
        return total + diff * diff * diff;
    }, 0) / n;
    return m3 / (std * std * std);
}

export function modeValue(value: RankValue): RankValue {
    const items = presentValues(value, 'mode');
    if (items.length === 0) {
        throw new RankError('mode requires at least one value', 'EmptyReduction');
    }
    const counts = new Map<RankValue, { count: number; order: number }>();
    let order = 0;
    for (const item of items) {
        const existing = counts.get(item);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(item, { count: 1, order: order++ });
        }
    }
    let maxCount = 0;
    let modeItem: RankValue = items[0];
    let minOrder = Infinity;
    for (const [item, info] of counts.entries()) {
        if (info.count > maxCount || (info.count === maxCount && info.order < minOrder)) {
            maxCount = info.count;
            modeItem = item;
            minOrder = info.order;
        }
    }
    return modeItem;
}

export function quantileValue(
    value: RankValue,
    qValue: RankValue = 0.5,
    axes?: readonly number[],
    isPercentile = false,
): RankValue {
    if (axes !== undefined) {
        if (!isRankArray(value)) {
            throw new RankError(`${isPercentile ? 'percentile' : 'quantile'} axis expects an array`);
        }
        return quantileByAxes(value, qValue, axes, isPercentile);
    }
    const qArray = isRankArray(qValue) ? qValue : undefined;
    if (qArray) {
        const quantiles = [];
        for (let i = 0; i < arraySize(qArray.shape); i++) {
            const item = readArrayItem(qArray, i);
            quantiles.push(singleQuantile(value, item, isPercentile));
        }
        return ownedArray(quantiles, qArray.shape);
    }
    return singleQuantile(value, qValue, isPercentile);
}

function singleQuantile(value: RankValue, qSingle: RankValue, isPercentile: boolean): number {
    let q = Number(expectNumeric(qSingle));
    if (isPercentile) q = q / 100;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
        throw new RankError(`${isPercentile ? 'percentile' : 'quantile'} expects q between 0 and 1`, 'DomainError');
    }
    const items = presentValues(value, isPercentile ? 'percentile' : 'quantile').map(item => {
        const numeric = Number(expectNumeric(item));
        if (!Number.isFinite(numeric)) {
            throw new RankError(`${isPercentile ? 'percentile' : 'quantile'} expects finite values`, 'DomainError');
        }
        return numeric;
    });
    if (items.length === 0) {
        throw new RankError(`${isPercentile ? 'percentile' : 'quantile'} requires at least one value`, 'EmptyReduction');
    }
    items.sort(interruptibleCallback((left, right) => left - right, 'sorting'));
    const n = items.length;
    if (n === 1) return items[0];
    const pos = q * (n - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    if (idx >= n - 1) return items[n - 1];
    return items[idx] + frac * (items[idx + 1] - items[idx]);
}

function quantileByAxes(
    value: RankArray,
    qValue: RankValue,
    axes: readonly number[],
    isPercentile: boolean,
): RankValue {
    for (const axis of axes) {
        checkpoint('computing statistics');
        if (axis >= value.shape.length) {
            throw new RankError(`array has no axis ${axis}`);
        }
    }
    if (new Set(axes).size !== axes.length) {
        throw new RankError(`${isPercentile ? 'percentile' : 'quantile'} axes must be unique`);
    }
    const selected = new Set(axes);
    const reducedAxes = value.shape.map((_, axis) => axis).filter(axis => selected.has(axis));
    const frameAxes = value.shape.map((_, axis) => axis).filter(axis => !selected.has(axis));
    const reducedShape = reducedAxes.map(axis => value.shape[axis]);
    const frameShape = frameAxes.map(axis => value.shape[axis]);
    const reducedSize = arraySize(reducedShape);

    const strides = value.shape.map(() => 1);
    for (let axis = strides.length - 2; axis >= 0; axis -= 1) {
        strides[axis] = strides[axis + 1] * value.shape[axis + 1];
    }
    const offsetAt = (index: number, axesList: readonly number[]): number => {
        let offset = 0;
        for (let current = axesList.length - 1; current >= 0; current -= 1) {
            const axis = axesList[current];
            offset += (index % value.shape[axis]) * strides[axis];
            index = Math.floor(index / value.shape[axis]);
        }
        return offset;
    };

    const valueAt = (frameIndex: number): RankValue => {
        const start = offsetAt(frameIndex, frameAxes);
        const items: RankValue[] = [];
        for (let index = 0; index < reducedSize; index += 1) {
            checkpoint('computing statistics');
            try {
                items.push(readArrayItem(value, start + offsetAt(index, reducedAxes)));
            } catch (error) {
                if (!(error instanceof MissingValueError)) throw error;
            }
        }
        return quantileValue({ kind: 'array', items, shape: [items.length] }, qValue, undefined, isPercentile);
    };

    return frameShape.length === 0
        ? valueAt(0)
        : derivedArray(frameShape, [value], valueAt, true);
}

export function covarianceValue(
    value: RankValue,
    axes?: readonly [number, number],
): RankArray {
    if (!isRankArray(value) || value.shape.length < 2) {
        throw new RankError('covariance expects a rank-2 or higher array', 'DimensionMismatch');
    }

    const featureAxis = axes?.[0] ?? value.shape.length - 2;
    const observationAxis = axes?.[1] ?? value.shape.length - 1;
    validateCovarianceAxis(value.shape, featureAxis);
    validateCovarianceAxis(value.shape, observationAxis);
    if (featureAxis === observationAxis) {
        throw new RankError('covariance axes must be unique');
    }

    const observations = value.shape[observationAxis];
    if (observations < 2) {
        throw new RankError('covariance requires at least two observations', 'InsufficientData');
    }
    const features = value.shape[featureAxis];
    const batchAxes = value.shape
        .map((_, axis) => axis)
        .filter(axis => axis !== featureAxis && axis !== observationAxis);
    const batchShape = batchAxes.map(axis => value.shape[axis]);
    const outputShape = [...batchShape, features, features];
    const means = new Map<number, number>();
    let meansRevision: number | undefined;

    const coordinatesFor = (batch: readonly number[], feature: number, observation: number) => {
        const coordinates = Array(value.shape.length).fill(0) as number[];
        batchAxes.forEach((axis, position) => {
            coordinates[axis] = batch[position];
        });
        coordinates[featureAxis] = feature;
        coordinates[observationAxis] = observation;
        return coordinates;
    };
    const meanAt = (batchIndex: number, batch: readonly number[], feature: number): number => {
        const currentRevision = arrayRevision(value);
        if (currentRevision === undefined || currentRevision !== meansRevision) {
            means.clear();
            meansRevision = currentRevision;
        }
        const key = batchIndex * features + feature;
        const cached = means.get(key);
        if (cached !== undefined) return cached;
        let total = 0;
        for (let observation = 0; observation < observations; observation += 1) {
            checkpoint('computing statistics');
            const coordinates = coordinatesFor(batch, feature, observation);
            total += Number(expectNumeric(arrayItem(value, arrayOffset(value.shape, coordinates))));
        }
        const result = total / observations;
        means.set(key, result);
        return result;
    };
    const resultAt = (index: number): number => {
        const output = coordinatesAt(outputShape, index);
        const batch = output.slice(0, batchShape.length);
        const batchIndex = arrayOffset(batchShape, batch);
        const leftFeature = output[batchShape.length];
        const rightFeature = output[batchShape.length + 1];
        const leftMean = meanAt(batchIndex, batch, leftFeature);
        const rightMean = meanAt(batchIndex, batch, rightFeature);
        let total = 0;
        for (let observation = 0; observation < observations; observation += 1) {
            checkpoint('computing statistics');
            const leftCoordinates = coordinatesFor(batch, leftFeature, observation);
            const rightCoordinates = coordinatesFor(batch, rightFeature, observation);
            const left = Number(expectNumeric(
                arrayItem(value, arrayOffset(value.shape, leftCoordinates)),
            ));
            const right = Number(expectNumeric(
                arrayItem(value, arrayOffset(value.shape, rightCoordinates)),
            ));
            total += (left - leftMean) * (right - rightMean);
        }
        const result = total / (observations - 1);
        return result;
    };

    return derivedArray(outputShape, [value], resultAt, true);
}

export function correlationValue(
    value: RankValue,
    axes?: readonly [number, number],
): RankArray {
    const cov = covarianceValue(value, axes);
    const shape = cov.shape;
    const features = shape[shape.length - 1];
    const matrixSize = features * features;

    const resultAt = (index: number): number => {
        const batchIndex = Math.floor(index / matrixSize);
        const rem = index % matrixSize;
        const i = Math.floor(rem / features);
        const j = rem % features;
        const offsetCov = batchIndex * matrixSize;
        const covIJ = Number(readArrayItem(cov, offsetCov + i * features + j));
        const covII = Number(readArrayItem(cov, offsetCov + i * features + i));
        const covJJ = Number(readArrayItem(cov, offsetCov + j * features + j));
        if (covII <= 0 || covJJ <= 0) return i === j ? 1 : 0;
        const r = covIJ / Math.sqrt(covII * covJJ);
        return Math.max(-1, Math.min(1, r));
    };

    return derivedArray(shape, [cov], resultAt, true);
}

export function meanValue(value: RankValue): number {
    const items = presentValues(value, 'mean');
    if (items.length === 0) {
        throw new RankError('mean requires at least one value', 'EmptyReduction');
    }
    let total = 0;
    for (const item of items) {
        checkpoint('computing statistics');
        total += Number(expectNumeric(item));
    }
    return total / items.length;
}

export function medianValue(value: RankValue): number {
    const values = presentValues(value, 'median').map(item => {
        const numeric = Number(expectNumeric(item));
        if (!Number.isFinite(numeric)) {
            throw new RankError('median expects finite values', 'DomainError');
        }
        return numeric;
    });
    if (values.length === 0) {
        throw new RankError('median requires at least one value', 'EmptyReduction');
    }
    values.sort(interruptibleCallback((left, right) => left - right, 'sorting'));
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 1
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
}

function presentValues(value: RankValue, operation: string): RankValue[] {
    if (!isRankArray(value)) return [...sequenceValues(value, operation)];
    const items: RankValue[] = [];
    for (let index = 0; index < arraySize(value.shape); index += 1) {
        checkpoint('computing statistics');
        try {
            items.push(arrayItem(value, index));
        } catch (error) {
            if (!(error instanceof MissingValueError)) throw error;
        }
    }
    return items;
}

function validateCovarianceAxis(shape: readonly number[], axis: number): void {
    if (axis < 0 || axis >= shape.length) {
        throw new RankError(`covariance axis out of bounds: ${axis}`);
    }
}

function arrayItem(value: RankArray, index: number): RankValue {
    return readArrayItem(value, index);
}

function coordinatesAt(shape: readonly number[], index: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = index % shape[axis];
        index = Math.floor(index / shape[axis]);
    }
    return result;
}

function arrayOffset(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce((offset, coordinate, axis) => offset * shape[axis] + coordinate, 0);
}

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}
