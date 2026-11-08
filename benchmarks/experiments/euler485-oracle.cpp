#include <algorithm>
#include <cstdint>
#include <deque>
#include <iostream>
#include <vector>
// Independent linear sieve, followed by an online monotone deque.
int main(int argc, char** argv) {
    uint32_t limit = argc > 1 ? std::stoul(argv[1]) : 100000000;
    uint32_t width = argc > 2 ? std::stoul(argv[2]) : 100000;
    std::vector<uint32_t> least(limit + 1), primes;
    std::vector<uint16_t> counts(limit + 1);
    std::vector<uint8_t> powers(limit + 1);
    counts[1] = 1;
    for (uint32_t n = 2; n <= limit; n++) {
        if (!least[n]) { least[n] = n; primes.push_back(n); counts[n] = 2; powers[n] = 1; }
        for (uint32_t prime : primes) {
            uint64_t next = uint64_t(n) * prime;
            if (next > limit) break;
            least[next] = prime;
            if (prime == least[n]) {
                powers[next] = powers[n] + 1;
                counts[next] = counts[n] / (powers[n] + 1) * (powers[next] + 1);
                break;
            }
            powers[next] = 1; counts[next] = counts[n] * 2;
        }
    }
    uint64_t answer = 0;
    std::deque<uint32_t> candidates;
    for (uint32_t n = 1; n <= limit; n++) {
        while (!candidates.empty() && candidates.front() + width <= n) candidates.pop_front();
        while (!candidates.empty() && counts[candidates.back()] <= counts[n]) candidates.pop_back();
        candidates.push_back(n);
        if (n >= width) answer += counts[candidates.front()];
    }
    std::cout << "{\"limit\":" << limit << ",\"width\":" << width << ",\"answer\":\"" << answer << "\"}\n";
}
