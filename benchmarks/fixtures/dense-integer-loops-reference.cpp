// Independent identity: d(n^2) = sum_{k^2|n} mu(k) d_3(n/k^2).
// Count ordered triples abc <= t by their sorted representatives a <= b <= c.
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>
using I = int64_t;
I triples(I t) {
 I sum=0;
 for(I a=1; a*a*a<=t; ++a) {
  I v=t/a;
  sum += 3*(v/a-a)+1;
  for(I b=a+1; b*b<=v; ++b) sum += 6*(v/b-b)+3;
 }
 return sum;
}
I lcm_count(I n) {
 I m=std::sqrt(n); while((m+1)*(m+1)<=n)++m;while(m*m>n)--m;
 std::vector<int> mu(m+1,1);std::vector<bool> composite(m+1);
 mu[0]=0;
 for(I p=2;p<=m;++p)if(!composite[p]) {
  for(I k=p;k<=m;k+=p){mu[k]=-mu[k];composite[k]=true;}
  for(I k=p*p;k<=m;k+=p*p)mu[k]=0;
 }
 I sum=0;
 for(I k=1;k<=m;++k)if(mu[k])sum+=mu[k]*triples(n/(k*k));
 return (sum+n+1)/2;
}


// Find station cycles with Floyd's algorithm, independently of the Rank
// factorization / multiplicative-order calculation. Then use patience sorting.
I uphill_paths(int count) {
 I total = 0;
 for (I k = 1; k <= count; ++k) {
  I n = k*k*k*k*k;
  if (n == 1) { ++total; continue; }
  using Station = std::pair<I, I>;
  auto step = [n](Station p) { return Station{p.first*2 % n, p.second*3 % n}; };
  Station start{1, 1}, slow = step(start), fast = step(step(start));
  while (slow != fast) { slow = step(slow); fast = step(step(fast)); }
  I prefix = 0, period = 1;
  slow = start;
  while (slow != fast) { slow = step(slow); fast = step(fast); ++prefix; }
  fast = step(slow);
  while (slow != fast) { fast = step(fast); ++period; }
  std::vector<I> keys;
  Station p = start;
  for (I i = 0; i < prefix+period; ++i) {
   keys.push_back(p.first*n+p.second); p = step(p);
  }
  std::sort(keys.begin(), keys.end());
  keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
  std::vector<I> tails;
  for (I key : keys) {
   I y = key % n;
   auto at = std::upper_bound(tails.begin(), tails.end(), y);
   if (at == tails.end()) tails.push_back(y); else *at = y;
  }
  total += tails.size();
 }
 return total;
}

// The sequential mex recurrence is evaluated directly. Nim multiplication
// uses recursive field decomposition instead of Rank's vectorized table build.
int nim_product(int a, int b) {
 if (a < 2 || b < 2) return a*b;
 static int memo[512][512] = {};
 int &cached = memo[a][b];
 if (cached) return cached;
 int k = 2;
 while (k*k <= std::max(a,b)) k *= k;
 int p11 = nim_product(a/k,b/k);
 return cached = ((p11 ^ nim_product(a/k,b%k) ^ nim_product(a%k,b/k))*k)
     ^ nim_product(a%k,b%k) ^ nim_product(p11,k/2);
}
I flipping_game(int n) {
 std::array<std::array<I,512>,2> hist{};
 std::array<int,2> last{};
 for (int axis = 0; axis < 2; ++axis) {
  std::vector<int> lengths;
  for (I k = 1;; ++k) {
   I length = axis == 0 ? k*(k+1)/2 : k*k;
   if (length > n) break;
   lengths.push_back(length);
  }
  std::vector<int> x(n+1);
  std::array<int,512> seen{};
  int active = 0;
  for (int i = 1; i <= n; ++i) {
   while (active < int(lengths.size()) && lengths[active] <= i) ++active;
   int previous = x[i-1];
   for (int j = 0; j < active; ++j) seen[previous ^ x[i-lengths[j]]] = i;
   int mex = 0;
   while (seen[mex] == i) ++mex;
   x[i] = previous ^ mex;
   for (int j = 0; j < active; ++j) ++hist[axis][x[i] ^ x[i-lengths[j]]];
  }
  last[axis] = x[n];
 }
 int target = nim_product(last[0],last[1]);
 I answer = 0;
 for (int a = 0; a < 512; ++a) for (int b = 0; b < 512; ++b)
  if (nim_product(a,b) == target) answer += hist[0][a]*hist[1][b];
 return answer;
}

int main(int argc, char** argv) {
 assert(argc == 3);
 int problem = std::atoi(argv[1]);
 I input = std::atoll(argv[2]);
 assert(input > 0);
 if (problem == 379) { assert(input <= 1000000000000LL); std::cout << lcm_count(input); }
 else if (problem == 411) { assert(input <= 30); std::cout << uphill_paths(input); }
 else if (problem == 459) { assert(input <= 1000000); std::cout << flipping_game(input); }
 else return 1;
 std::cout << "\n";
}
