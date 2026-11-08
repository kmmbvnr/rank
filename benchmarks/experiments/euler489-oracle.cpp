#include <algorithm>
#include <cstdint>
#include <iostream>
#include <numeric>
#include <vector>
using U = uint64_t;
using Wide = __uint128_t;
U power(U a,U e,U m) { U r=1%m; for(;e;e/=2,a=Wide(a)*a%m) if(e%2)r=Wide(r)*a%m; return r; }
U cube(U x,U m) { return Wide(Wide(x)*x%m)*x%m; }
std::vector<std::pair<U,U>> factors(U n) {
    std::vector<std::pair<U,U>> out;
    for(U p=2;p<=n/p;p+=(p==2?1:2)) if(n%p==0) {
        U degree=0; do {n/=p;degree++;}while(n%p==0);
        out.push_back({p,degree});
    }
    if(n>1)out.push_back({n,1}); return out;
}
U common(U a,U b,U &largestRoots,U &largestCrt) {
    const U a3=a*a*a,resultant=a3*(a3*a3+27*b*b);
    U scale=1;std::vector<U> current{0};
    for(auto [p,degree]:factors(resultant)) {
        U mod=1;std::vector<U> roots{0};
        for(U level=0;level<degree;level++) {
            U next=mod*p;std::vector<U> found;
            if(p>3 && a%p) {
                U phi=next/p*(p-1),inverse=power(2*a*a,phi-1,next);
                U x=Wide((next-(3*b+a3)%next)%next)*inverse%next;
                if((cube(x,next)+b)%next==0 && (cube(x+a,next)+b)%next==0)found.push_back(x);
            } else for(U x:roots) for(U digit=0;digit<p;digit++) {
                U candidate=x+mod*digit;
                if((cube(candidate,next)+b)%next==0 && (cube(candidate+a,next)+b)%next==0)found.push_back(candidate);
            }
            if(found.empty())break;
            mod=next;roots=std::move(found);
        }
        largestRoots=std::max<U>(largestRoots,roots.size());
        if(mod==1)continue;
        U inverse=power(scale%mod,mod/p*(p-1)-1,mod);
        std::vector<U> combined;
        for(U x:current) for(U y:roots) {
            U delta=(y+mod-x%mod)%mod;
            U step=Wide(delta)*inverse%mod;
            combined.push_back(x+scale*step);
        }
        current=std::move(combined);scale*=mod;
        largestCrt=std::max<U>(largestCrt,current.size());
    }
    return *std::min_element(current.begin(),current.end());
}
U brute(U a,U b) {
    U a3=a*a*a,bound=a3*(a3*a3+27*b*b),best=0,first=0;
    for(U n=0;n<bound;n++) {
        U x=n*n*n+b,y=(n+a)*(n+a)*(n+a)+b,g=std::gcd(x,y);
        if(g>best){best=g;first=n;}
    }
    return first;
}
int main(int argc,char **argv) {
    U ma=argc>1?std::stoull(argv[1]):18,nb=argc>2?std::stoull(argv[2]):1900;
    bool direct=argc>3 && std::string(argv[3])=="brute";
    bool single=argc>3 && std::string(argv[3])=="single";
    if(ma>18 || nb>1900 || direct && (ma>4 || nb>6)) return 2;
    U sum=0,maxRoots=0,maxCrt=0;
    if(single) {
        sum=common(ma,nb,maxRoots,maxCrt);
        std::cout<<"{\"a\":"<<ma<<",\"b\":"<<nb<<",\"answer\":\""<<sum<<"\",\"maxRoots\":"<<maxRoots<<",\"maxCrt\":"<<maxCrt<<"}\n";
        return 0;
    }
    for(U a=1;a<=ma;a++)for(U b=1;b<=nb;b++) {
        U value=common(a,b,maxRoots,maxCrt);
        if(direct && value!=brute(a,b))return 3;
        sum+=value;
    }
    std::cout<<"{\"ma\":"<<ma<<",\"nb\":"<<nb<<",\"answer\":\""<<sum<<"\",\"maxRoots\":"<<maxRoots<<",\"maxCrt\":"<<maxCrt<<",\"bruteChecked\":"<<(direct?"true":"false")<<"}\n";
}
