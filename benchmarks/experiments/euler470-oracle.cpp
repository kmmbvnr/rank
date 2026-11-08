// Independent per-subset dynamic programming and birth-death visit weights.
// No gain histograms, sorting, threshold tables, or linear system solver.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <vector>
long double choose(int n,int k) {
    long double v=1;
    for(int j=1;j<=k;j++)v=v*(n-j+1)/j;
    return v;
}
int main(int argc,char** argv) {
    int n=argc>1?std::atoi(argv[1]):20;
    if(n<0 || n>20) return 2;
    std::vector<long double> weight(n+1), scores(n+1);
    long double total=0;
    for(int d=4;d<=n;d++) {
        for(int k=1;k<=d;k++) {
            weight[k]=0;
            for(int j=0;j<k;j++)weight[k]+=1/choose(d-1,j);
        }
        std::fill(scores.begin(),scores.end(),0);
        for(unsigned mask=1;mask<(1u<<d);mask++) {
            int count=__builtin_popcount(mask), largest=32-__builtin_clz(mask);
            scores[0]+=largest*weight[count];
            long double h=0;
            for(int step=0;step<d;step++) {
                long double next=0;
                for(int face=1;face<=d;face++)
                    if(mask&(1u<<(face-1)))next+=std::max((long double)face,h);
                next/=count;
                long double gain=next-h;
                for(int c=1;c<=n;c++)scores[c]+=std::max(gain-c,0.L)*weight[count];
                h=next;
            }
        }
        for(auto score:scores)total+=score;
    }
    std::cout<<std::setprecision(18)<<"{\"n\":"<<n<<",\"total\":"<<total
        <<",\"answer\":"<<std::floor(total+.5L)<<",\"costOne\":"<<(n>0?scores[1]:0)<<"}\n";
}
