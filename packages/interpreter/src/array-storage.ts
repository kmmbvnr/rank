// Stable storage API; implementation modules own storage, readers and dependency policies.
export {
    createArraySnapshot, isFlatScalarArray, denseScalarItems, storedScalarKinds, realCells,
    writableIntegerCells, writeArrayCell, hasWritableBooleanCells, fillBooleanSelection,
    writeIntegerSelection, float64Cells, storedOperandItems, eagerOperandItems, ownedArray, ownedScalarArray,
    filledArray, typedArray, IntegerCells, sharedTypedArray, reshapeStoredArray, typedElementKind, maskedArray, maskedCells,
    maskedNumericCells, hasMaskedCells, prepareScalarArrayWriter,
} from './owned-array.js';
export {
    eagerArrayStorage, registerCachedArray, materializedArrayItems, copyMaterializedArrayItems,
    registerArrayReadPlan, prepareArrayRead, MAX_HELD_CELLS, STREAM_CELLS, shouldStream, streamCells,
    materializeCells, readCellOrMissing, borrowArrayStorage, prepareArrayReader, prepareScalarArrayReader,
    readArrayItem, readArrayShape, registerArrayCellEvaluation, evaluateArrayItem,
} from './array-read.js';
export { validityWords, allPresent, isPresentAt, allValid } from './array-validity.js';
export {
    retainSelectionSnapshot, holdArraySource, noteArrayBinding, noteArrayBorrow, isSharedArray,
    privateArrayCopy, arrayForWrite,
} from './array-ownership.js';
export {
    arrayRevision, ownedObject, arrayDependencyNode, registerArrayDependencies,
} from './array-revision.js';
export { arrayCellValidator, derivedArray } from './derived-array.js';
export { enterRuntime, leaveRuntime } from './array-storage-state.js';
