export const denseSource = `
use ranges
fun densewrite N
 A = array shape N pad 0
 for I in 0 until N
  A I = I
 end
 return A (N - 1)
end
fun matrixwrite N
 M = array shape N 1 pad 0
 for I in 0 until N
  M I 0 = 1
 end
 return M (N - 1) 0
end
fun denseupdate N
 A = array shape N pad 0
 for I in 0 until N
  A I += 1
 end
 return A (N - 1)
end
fun denseread N
 A = array shape N pad 1
 Total = 0
 for I in 0 until N
  Total += A I
 end
 return Total
end
`;
export const denseCases = [
 ['densewrite', [1000000n], 999999n, [1000n]],
 ['matrixwrite', [1000000n], 1n, [1000n]],
 ['denseupdate', [1000000n], 1n, [1000n]],
 ['denseread', [1000000n], 1000000n, [1000n]],
];

// Independent integer oracles; no expected answers come from Rank execution.
export function gridCase(size = 1000) {
 const row = Array(size).fill(0n);
 row[0] = 1n;
 for (let y = 0; y < size; y++) for (let x = 1; x < size; x++) {
  row[x] = (row[x] + row[x - 1]) % 1000000007n;
 }
 return { name: 'gridpaths', path: 'demos/cses/dynamic/006_gridpaths.ra',
  input: `${size}\n${('.'.repeat(size) + '\n').repeat(size)}`, expected: String(row[size - 1]) };
}
export function dpCases() {
 const n = 1000000;
 const ring = Array(6).fill(0n);
 ring[0] = 1n;
 for (let i = 1; i <= n; i++) ring[i % 6] = ring.reduce((a, b) => a + b) % 1000000007n;
 return [
  { name: 'dice', path: 'demos/cses/dynamic/001_dice.ra', input: `${n}\n`, expected: String(ring[n % 6]) },
  gridCase(),
  { name: 'bookshop', path: 'demos/cses/dynamic/007_bookshop.ra',
   input: `100 10000\n${'1 '.repeat(100)}\n${'1 '.repeat(100)}\n`, expected: '100' },
  { name: 'editdistance', path: 'demos/cses/dynamic/010_editdistance.ra',
   input: `${'a'.repeat(1000)}\n${'b'.repeat(1000)}\n`, expected: '1000' },
 ];
}
