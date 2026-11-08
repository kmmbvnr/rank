// Independent native residue DP. Build each permutation on demand and reduce
// every addition, without a quadratic table or deferred Int64 growth budget.
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <numeric>
#include <vector>
constexpr uint64_t MOD=10000000000000061ULL;
uint64_t add(uint64_t a,uint64_t b){auto v=a+b;return v>=MOD?v-MOD:v;}
uint64_t power(uint64_t b,uint64_t e,uint64_t m){uint64_t r=1%m;for(;e;e>>=1,b=b*b%m)if(e&1)r=r*b%m;return r;}
int main(int argc,char**argv){
    int n=argc>1?std::atoi(argv[1]):1000000;
    uint64_t d=argc>2?std::strtoull(argv[2],nullptr,10):65432;
    unsigned digits=std::to_string(d).size(),a=digits,b=digits;
    if(d){auto t=d;a=b=0;while(t%2==0){t/=2;a++;}while(t%5==0){t/=5;b++;}a=std::min(a,digits);b=std::min(b,digits);}
    uint64_t base=1,decimal=1;for(unsigned i=0;i<a;i++)base*=2;for(unsigned i=0;i<b;i++)base*=5;
    for(unsigned i=0;i<digits;i++)decimal*=10;
    uint64_t m=decimal/base;
    if(n<0||m>100000)return 2;
    std::vector<bool> composite(n+1);std::vector<unsigned> primes,exponents;
    unsigned e2=0,e5=0;
    for(int p=2;p<=n;p++)if(!composite[p]){
        for(int64_t j=int64_t(p)*p;j<=n;j+=p)composite[j]=true;
        unsigned e=0;for(int q=n/p;q;q/=p)e+=q;
        primes.push_back(p);exponents.push_back(e);if(p==2)e2=e;if(p==5)e5=e;
    }
    if(a>e2||b>e5){std::cout<<"0\n";return 0;}
    std::vector<unsigned> units;std::vector<int> positions(m,-1);
    for(unsigned r=0;r<m;r++)if(std::gcd(uint64_t(r),m)==1){positions[r]=units.size();units.push_back(r);}
    std::vector<uint64_t> counts(units.size());counts[0]=1;
    for(size_t i=0;i<primes.size();i++){
        auto p=primes[i];if(std::gcd(uint64_t(p),m)!=1)continue;
        unsigned e=exponents[i]-(p==2?a:p==5?b:0);
        auto inverse=power(p,units.size()-1,m);
        std::vector<unsigned> first(units.size());
        for(size_t j=0;j<units.size();j++)first[j]=positions[units[j]*inverse%m];
        auto original=counts;unsigned length=1,terms=e+1;
        for(int bit=30-__builtin_clz(terms);bit>=0;bit--){
            auto step=power(inverse,length,m);std::vector<uint64_t> next(counts.size());
            for(size_t j=0;j<counts.size();j++)next[j]=add(counts[j],counts[positions[units[j]*step%m]]);
            counts.swap(next);length*=2;
            if((terms>>bit)&1){for(size_t j=0;j<counts.size();j++)next[j]=add(original[j],counts[first[j]]);counts.swap(next);length++;}
        }
    }
    std::cout<<counts[positions[(d/base)%m]]<<"\n";
}
