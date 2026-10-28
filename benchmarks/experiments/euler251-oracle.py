#!/usr/bin/env python3
"""Independent direct enumeration for small Euler 251 bounds (not the sieve)."""
import argparse


def count_triplets(limit):
    count = 0
    for k in range(1, (limit + 1) // 3 + 1):
        a = 3 * k - 1
        product = k * k * (8 * k - 3)
        for b in range(1, max(1, limit - a)):
            c, remainder = divmod(product, b * b)
            if remainder == 0 and a + b + c <= limit:
                count += 1
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=1000)
    args = parser.parse_args()
    print(count_triplets(args.limit))
