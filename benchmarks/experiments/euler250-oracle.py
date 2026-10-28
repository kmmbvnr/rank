#!/usr/bin/env python3
"""Independent Euler 250 oracle; exact direct DP, no periodic reduction."""
import argparse


def subsets(n, m, modulus):
    counts = [0] * m
    counts[0] = 1
    for k in range(1, n + 1):
        residue = pow(k, k, m)
        counts = [(counts[s] + counts[(s - residue) % m]) % modulus
                  for s in range(m)]
    return (counts[0] - 1) % modulus


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--N', type=int, default=250250)
    parser.add_argument('--M', type=int, default=250)
    parser.add_argument('--Mod', type=int, default=10**16)
    args = parser.parse_args()
    answer = subsets(args.N, args.M, args.Mod)
    if 0 <= args.N <= 16:
        residues = [pow(k, k, args.M) for k in range(1, args.N + 1)]
        exhaustive = sum(sum(residues[k] for k in range(args.N) if mask >> k & 1)
                         % args.M == 0 for mask in range(1, 1 << args.N)) % args.Mod
        assert answer == exhaustive
    if (args.N, args.M, args.Mod) == (250250, 250, 10**16):
        assert answer == 1425480602091519
    print(answer)
