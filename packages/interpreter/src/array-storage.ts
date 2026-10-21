// Stable storage API; implementation modules own storage, readers and dependency policies.
export {
    createArraySnapshot, isFlatScalarArray, denseScalarItems, storedScalarKinds, realCells,
    writableIntegerCells, writeArrayCell, hasWritableBooleanCells, fillBooleanSelection,
    writeIntegerSelection, float64Cells, storedOperandItems, eagerOperandItems, ownedArray, ownedScalarArray,
    filledArray, typedArray, IntegerCells, sharedTypedArray, reshapeStoredArray, typedElementKind, maskedArray, maskedCells,
    maskedNumericCells, hasMaskedCells, prepareScalarArrayWriter,
} from './owned-array.js';
export {
    eagerArrayStorage, materializedArrayItems, storedArrayValues, copyMaterializedArrayItems,
    registerArrayReadPlan, prepareArrayRead, arrayCells, arrayFrameAxes, arrayValueTraversal, arrayValues, collectArrayValues, collectArrayCells, MAX_HELD_CELLS, STREAM_CELLS, shouldStream, streamCells,
    materializeCells, readCellOrMissing, borrowArrayStorage, prepareArrayReader, prepareScalarArrayReader, prepareMatrixArrayReader,
    readArrayItem, readArrayShape, registerArrayCellEvaluation, evaluateArrayItem,
} from './array-read.js';
export type { ArrayCells } from './array-read.js';
export { validityWords, allPresent, isPresentAt, allValid } from './array-validity.js';
export {
    retainSelectionSnapshot, holdArraySource, noteArrayBinding, noteArrayBorrow, isSharedArray, hasPendingSelections,
    privateArrayCopy, arrayForWrite,
} from './array-ownership.js';
export {
    arrayRevision, arrayResourceValues, ownedObject, arrayDependencyNode, registerArrayDependencies,
} from './array-revision.js';
export { arrayCellValidator, derivedArray } from './derived-array.js';
