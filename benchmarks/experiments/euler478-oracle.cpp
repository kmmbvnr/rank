// Linear number-theory sieve, grouped lattice counts, exact 128-bit triple count.
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
using wide = __int128_t;
constexpr int64_t modulus=214358881, period=194871710;
int64_t power(int64_t base,int64_t exponent){
    int64_t result=1;
    for(;exponent;exponent>>=1,base=base*base%modulus)if(exponent&1)result=result*base%modulus;
    return result;
}
std::string decimal(wide value){
    if(!value)return "0";
    std::string result;
    while(value){result=char('0'+value%10)+result;value/=10;}
    return result;
}
int main(int argc,char**argv){
    const int n=argc>1?std::atoi(argv[1]):10000000;
    if(n<1)return 2;
    std::vector<int> least(n+1),phi(n+1),primes;
    std::vector<int8_t> mu(n+1);
    phi[1]=mu[1]=1;
    for(int i=2;i<=n;i++){
        if(!least[i]){least[i]=i;phi[i]=i-1;mu[i]=-1;primes.push_back(i);}
        for(int prime:primes){
            int64_t next=int64_t(i)*prime;
            if(next>n||prime>least[i])break;
            least[next]=prime;
            if(i%prime==0){phi[next]=phi[i]*prime;mu[next]=0;}
            else{phi[next]=phi[i]*(prime-1);mu[next]=-mu[i];}
        }
    }
    for(int i=1;i<=n;i++)least[i]=least[i-1]+mu[i];
    std::vector<int8_t>().swap(mu);
    std::vector<int>().swap(primes);
    std::vector<int64_t> counts(n+1,1);
    wide primitive=0;
    for(int left=1;left<=n;){
        const int top=n/left,right=n/top,weight=least[right]-least[left-1];
        const wide side=top+1;
        primitive+=weight*(side*side*side-1);
        if(weight)for(int slope=1;slope<=top;slope++){
            const int64_t q=top/slope;
            counts[slope]+=int64_t(weight)*(q*top-int64_t(slope)*q*(q+1)/2);
        }
        left=right+1;
    }
    const wide half=(primitive-1)/2;
    constexpr int stride=16384;
    std::vector<int64_t> lower(stride),upper(period/stride+1);
    lower[0]=upper[0]=1;
    for(int i=1;i<stride;i++)lower[i]=lower[i-1]*2%modulus;
    const int64_t step=power(2,stride);
    for(size_t i=1;i<upper.size();i++)upper[i]=upper[i-1]*step%modulus;
    int64_t total=0,sum=0;
    for(int i=1;i<=n;i++){
        int64_t exponent=int64_t((half-counts[i])%period);
        if(exponent<0)exponent+=period;
        const int64_t value=lower[exponent%stride]*upper[exponent/stride]%modulus;
        total=(total+6LL*phi[i]%modulus*value)%modulus;
        sum+=phi[i];
    }
    const int64_t bad=(1+power(2,int64_t(half%period))*(6*sum%modulus)%modulus-total+modulus)%modulus;
    const int64_t answer=(power(2,int64_t(primitive%period))-bad+modulus)%modulus;
    std::cout<<"{\"n\":"<<n<<",\"primitive\":\""<<decimal(primitive)<<"\",\"phiSum\":"<<sum
        <<",\"firstCount\":"<<counts[1]<<",\"lastCount\":"<<counts[n]<<",\"answer\":"<<answer<<"}\n";
}
