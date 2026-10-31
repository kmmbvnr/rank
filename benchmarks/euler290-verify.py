"""Compare frozen Rank prototypes against direct enumeration of integers."""
import json
import subprocess


def digit_sum(n):
    total = 0
    while n:
        total += n % 10
        n //= 10
    return total


def main():
    expected, count, boundary = {}, 0, 1
    for value in range(10**6):
        count += digit_sum(value) == digit_sum(137 * value)
        if value + 1 == boundary:
            expected[len(str(boundary)) - 1] = count
            boundary *= 10
    results = []
    for mode in ['compiled', 'reference']:
        variants = ['original', 'reorder', 'bounds', 'both', 'prune', 'window', 'terminal', 'vector', 'lowered', 'shipping'] if mode == 'compiled' else ['original', 'window', 'vector', 'lowered', 'shipping']
        sizes = range(7) if mode == 'compiled' else [0, 3, 6]
        for variant in variants:
            for n in sizes:
                result = json.loads(subprocess.check_output([
                    'node', 'benchmarks/euler290-investigation.mjs', mode, variant, str(n)
                ], text=True))
                assert int(result['answer']) == expected[n], (result, expected[n])
                results.append(result)
    print(json.dumps({'oracle': expected, 'comparisons': len(results), 'results': results}, indent=2))


if __name__ == '__main__':
    main()
