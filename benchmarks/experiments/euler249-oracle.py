"""Independent small-input oracle: unbounded counts, reduction only at the end."""
import argparse


def is_prime(value):
    return value >= 2 and all(value % d for d in range(2, int(value ** 0.5) + 1))


def subset_count(limit):
    primes = [p for p in range(2, limit) if is_prime(p)]
    if len(primes) <= 10:
        # Enumerate the subsets themselves, independently of the DP recurrence.
        return sum(is_prime(sum(p for i, p in enumerate(primes) if mask >> i & 1))
                   for mask in range(1 << len(primes)))
    counts = [0] * (sum(primes) + 1)
    counts[0] = 1
    top = 0
    for prime in primes:
        top += prime
        for total in range(top, prime - 1, -1):
            counts[total] += counts[total - prime]
    return sum(count for total, count in enumerate(counts) if is_prime(total))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=300)
    parser.add_argument('--mod', type=int, default=10 ** 16)
    args = parser.parse_args()
    print(subset_count(args.limit) % args.mod)
