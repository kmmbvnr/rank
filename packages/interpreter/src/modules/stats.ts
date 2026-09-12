import { MissingValueError, RankError } from '../errors.js';
import { sequenceValues } from '../sequence.js';
import { mapBroadcastArrays } from '../tensor.js';
import { aggregateGroupedColumn } from './tables.js';
import {
    isRankArray,
    isRankGroupedColumn,
    isRankSequence,
    type RankArray,
    type RankValue,
} from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const statsModule: RuntimeModule = {
    mean: () => native('mean', 1, ([value]) => isRankGroupedColumn(value)
        ? aggregateGroupedColumn(value, meanValue, true) : meanValue(value)),
    median: () => native('median', 1, ([value]) => isRankGroupedColumn(value)
        ? aggregateGroupedColumn(value, medianValue, true) : medianValue(value)),
    std: () => native('std', 1, ([value]) => isRankGroupedColumn(value)
        ? aggregateGroupedColumn(value, standardDeviation, true) : standardDeviation(value)),
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
    return {
        kind: 'array',
        items,
        shape: isRankSequence(value) ? [items.length] : [],
    };
}

function metricByAxes(
    losses: RankArray,
    axes: readonly number[],
    metric: 'mse' | 'mae',
): RankValue {
    for (const axis of axes) {
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
            coordinatesAt(reducedShape, index).forEach((coordinate, position) => {
                source[reducedAxes[position]] = coordinate;
            });
            total += Number(arrayItem(losses, arrayOffset(losses.shape, source)));
        }
        return total / reducedSize;
    };

    return frameShape.length === 0
        ? valueAt(0)
        : lazyNumericArray(frameShape, valueAt);
}

function lazyNumericArray(
    shape: readonly number[],
    operation: (index: number) => number,
): RankArray {
    const cache = new Map<number, number>();
    const itemAt = (index: number): number => {
        const cached = cache.get(index);
        if (cached !== undefined) return cached;
        const result = operation(index);
        cache.set(index, result);
        return result;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        containsFiles: false,
        get items() {
            materialized ??= Array.from(
                { length: arraySize(shape) },
                (_, index) => itemAt(index),
            );
            return materialized;
        },
    };
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
        const difference = value - mean;
        squared += difference * difference;
    }
    return Math.sqrt(squared / count);
}

function standardDeviation(value: RankValue): number {
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
    const results = new Map<number, number>();

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
        const key = batchIndex * features + feature;
        const cached = means.get(key);
        if (cached !== undefined) return cached;
        let total = 0;
        for (let observation = 0; observation < observations; observation += 1) {
            const coordinates = coordinatesFor(batch, feature, observation);
            total += Number(expectNumeric(arrayItem(value, arrayOffset(value.shape, coordinates))));
        }
        const result = total / observations;
        means.set(key, result);
        return result;
    };
    const resultAt = (index: number): number => {
        const cached = results.get(index);
        if (cached !== undefined) return cached;
        const output = coordinatesAt(outputShape, index);
        const batch = output.slice(0, batchShape.length);
        const batchIndex = arrayOffset(batchShape, batch);
        const leftFeature = output[batchShape.length];
        const rightFeature = output[batchShape.length + 1];
        const leftMean = meanAt(batchIndex, batch, leftFeature);
        const rightMean = meanAt(batchIndex, batch, rightFeature);
        let total = 0;
        for (let observation = 0; observation < observations; observation += 1) {
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
        results.set(index, result);
        return result;
    };

    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: outputShape,
        itemAt: resultAt,
        containsFiles: false,
        get items() {
            materialized ??= Array.from(
                { length: arraySize(outputShape) },
                (_, index) => resultAt(index),
            );
            return materialized;
        },
    };
}

function meanValue(value: RankValue): number {
    const items = presentValues(value, 'mean');
    if (items.length === 0) {
        throw new RankError('mean requires at least one value', 'EmptyReduction');
    }
    let total = 0;
    for (const item of items) total += Number(expectNumeric(item));
    return total / items.length;
}

function medianValue(value: RankValue): number {
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
    values.sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 1
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
}

function presentValues(value: RankValue, operation: string): RankValue[] {
    if (!isRankArray(value)) return [...sequenceValues(value, operation)];
    const items: RankValue[] = [];
    for (let index = 0; index < arraySize(value.shape); index += 1) {
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
    return value.itemAt?.(index) ?? value.items[index];
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
