#include <algorithm>
#include <cstdint>
#include <iostream>
#include <vector>
using U=uint64_t;
U power(U a,U e,U m) {U r=1%m;for(;e;e/=2,a=a*a%m)if(e%2)r=r*a%m;return r;}
bool prime(U n){if(n<2)return false;for(U d=2;d<=n/d;d++)if(n%d==0)return false;return true;}
U interpolate(const std::vector<U>&y,U n,U p){
    U d=y.size()-1,x=n%p;if(x<=d)return y[x];
    std::vector<U>fact(d+1,1),inv(d+1,1),left(d+2,1),right(d+2,1);
    for(U i=1;i<=d;i++)fact[i]=fact[i-1]*i%p;
    inv[d]=power(fact[d],p-2,p);for(U i=d;i>0;i--)inv[i-1]=inv[i]*i%p;
    for(U i=0;i<=d;i++)left[i+1]=left[i]*((x+p-i)%p)%p;
    for(U i=d+1;i>0;i--)right[i-1]=right[i]*((x+p-(i-1))%p)%p;
    U total=0;
    for(U i=0;i<=d;i++){
        U term=left[i]*right[i+1]%p*inv[i]%p*inv[d-i]%p*y[i]%p;
        total=(total+((d-i)%2?p-term:term))%p;
    }
    return total;
}
int main(int argc,char**argv){
    U k=argc>1?std::stoull(argv[1]):10000,n=argc>2?std::stoull(argv[2]):1000000000000ULL;
    U low=argc>3?std::stoull(argv[3]):2000000000ULL,width=argc>4?std::stoull(argv[4]):2000;
    U answer=0,count=0;
    for(U p=std::max<U>(2,low);p<=low+width;p++)if(prime(p)){
        count++;
        if(p<=k+2){
            U r=n%p,cycle=0,tail=0;
            for(U i=1;i<=p;i++){
                U term=(r+1+p-i)%p*power(i,k,p)%p;cycle=(cycle+term)%p;
                if(i<=r)tail=(tail+term)%p;
            }
            answer+=(n/p%p*cycle+tail)%p;continue;
        }
        std::vector<U>a(k+3),b(k+3);
        for(U i=1;i<=k+2;i++){
            U v=power(i,k,p);a[i]=(a[i-1]+v)%p;b[i]=(b[i-1]+v*i)%p;
        }
        U first=interpolate(a,n,p),second=interpolate(b,n,p);
        answer+=(((n+1)%p)*first+p-second)%p;
    }
    std::cout<<"{\"k\":"<<k<<",\"n\":\""<<n<<"\",\"low\":"<<low<<",\"width\":"<<width<<",\"primes\":"<<count<<",\"answer\":\""<<answer<<"\"}\n";
}
