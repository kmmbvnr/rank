import { RankError } from '../errors.js';
import { sequenceValues } from '../sequence.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const statsModule: RuntimeModule = {
    mean: () => native('mean', 1, arguments_ => meanValue(arguments_[0])),
    std: () => native('std', 1, arguments_ => standardDeviation(arguments_[0])),
    covariance: () => native(
        'covariance',
        1,
        arguments_ => covarianceValue(arguments_[0]),
    ),
};

function standardDeviation(value: RankValue): number {
    const items = isRankArray(value) ? value.items : [...sequenceValues(value, 'std')];
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
    const items = isRankArray(value) ? value.items : [...sequenceValues(value, 'mean')];
    if (items.length === 0) {
        throw new RankError('mean requires at least one value', 'EmptyReduction');
    }
    let total = 0;
    for (const item of items) total += Number(expectNumeric(item));
    return total / items.length;
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
