// Compatibility exports. Arithmetic folds lower into the shared tensor IR
// and use its inline/native generators; no reader-tree compiler lives here.
export { compileFusedReduction, compileFusedSum } from './tensor-fold.js';
