// Independent per-radius adjacency lists; deliberately retain the loose pair bounds.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <numeric>
#include <vector>
using wide = __uint128_t;
uint64_t root(uint64_t value){
    uint64_t result=std::sqrt(static_cast<long double>(value));
    while(wide(result+1)*(result+1)<=value)result++;
    while(wide(result)*result>value)result--;
    return result;
}
struct Leg {uint32_t x,h;bool operator<(const Leg&b)const{return x<b.x;}bool operator==(const Leg&b)const{return x==b.x&&h==b.h;}};
int main(int argc,char**argv){
    const uint64_t perimeter=argc>1?std::strtoull(argv[1],nullptr,10):10000000,half=perimeter/2;
    const uint64_t radius=root(perimeter*perimeter/108),limit=root(radius+half)+2;
    std::vector<std::vector<Leg>> legs(radius+1);
    for(uint64_t m=2;m<limit;m++)for(uint64_t n=1;n<m;n++){
        if((m-n)%2==0||std::gcd(m,n)!=1)continue;
        const uint64_t a=m*m-n*n,b=2*m*n,c=m*m+n*n;
        for(int order=0;order<2;order++){
            const uint64_t r=order?b:a,x=order?a:b;
            const uint64_t count=std::min(radius/r,half/x);
            for(uint64_t k=1;k<=count;k++)legs[k*r].push_back({uint32_t(k*x),uint32_t(k*c)});
        }
    }
    uint64_t answer=0,triangles=0,records=0,pairs=0;
    for(uint64_t r=1;r<=radius;r++){
        auto& row=legs[r];std::sort(row.begin(),row.end());row.erase(std::unique(row.begin(),row.end()),row.end());records+=row.size();
        const uint64_t square=r*r;
        for(size_t i=0;i<row.size();i++){
            const uint64_t x=row[i].x;
            if(x*x>3*square)break;
            const uint64_t low=square/x,high=std::min(3*square/x,half);
            auto start=std::upper_bound(row.begin(),row.end(),Leg{uint32_t(low),0});
            for(size_t j=std::max(i,size_t(start-row.begin()));j<row.size()&&row[j].x<=high;j++){
                pairs++;const uint64_t y=row[j].x,denominator=x*y-square;
                const wide numerator=wide(square)*(x+y);
                if(numerator%denominator)continue;
                const wide z=numerator/denominator;
                if(z<y||x+y+z>half)continue;
                const uint64_t squareZ=uint64_t(z*z+square),h=root(squareZ);
                if(h*h!=squareZ)continue;
                answer+=2*(x+y+uint64_t(z))+row[i].h+row[j].h+h;triangles++;
            }
        }
    }
    std::cout<<"{\"p\":"<<perimeter<<",\"answer\":"<<answer<<",\"triangles\":"<<triangles
        <<",\"records\":"<<records<<",\"pairs\":"<<pairs<<"}\n";
}
