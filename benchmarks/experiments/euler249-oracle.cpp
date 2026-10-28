// Full-input control with bounded uint64 arithmetic and an independent sieve.
// clang++ -O3 -std=c++17 benchmarks/experiments/euler249-oracle.cpp -o /tmp/euler249-oracle
#include <cstdint>
#include <iostream>
#include <vector>

int main(int argc, char** argv) {
    const int limit = argc > 1 ? std::stoi(argv[1]) : 5000;
    std::vector<int> primes;
    for (int p = 2; p < limit; ++p) {
        bool prime = true;
        for (int d = 2; d * d <= p; ++d) {
            if (p % d == 0) { prime = false; break; }
        }
        if (prime) primes.push_back(p);
    }
    int maximum = 0;
    for (int p : primes) maximum += p;
    constexpr uint64_t modulus = 10000000000000000ULL;
    std::vector<uint64_t> ways(maximum + 1);
    ways[0] = 1;
    int top = 0;
    for (int p : primes) {
        top += p;
        for (int sum = top; sum >= p; --sum) {
            const uint64_t value = ways[sum] + ways[sum - p];
            ways[sum] = value >= modulus ? value - modulus : value;
        }
    }
    std::vector<bool> prime(maximum + 1, true);
    prime[0] = false;
    if (maximum >= 1) prime[1] = false;
    for (int p = 2; p * p <= maximum; ++p) {
        if (prime[p]) for (int s = p * p; s <= maximum; s += p) prime[s] = false;
    }
    uint64_t answer = 0;
    for (int s = 2; s <= maximum; ++s) {
        if (prime[s]) answer = (answer + ways[s]) % modulus;
    }
    std::cout << answer << '\n';
}
