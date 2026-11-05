import {readFileSync,writeFileSync} from 'node:fs';
const [directory,style='quad']=process.argv.slice(2);
if(!directory)throw Error('pass an isolated interpreter/out directory');
const path=`${directory}/modules/linalg.js`;
const marker='function numberMatmul(leftItems, rightItems, size, contracted, leftInner, rightInner, outputShape, outputStrides, leftRank) {';
let source=readFileSync(path,'utf8');
if(!source.includes(marker)||source.includes('Euler 416 research control'))throw Error('expected fresh compiled linalg.js');
const kernel=`
    // Euler 416 research control: canonical stored 2-D products only.
    if (privateLoopPolling() && outputShape.length === 2 && leftRank === 1
        && leftInner === 1 && rightInner === outputShape[1]
        && outputStrides[0] === contracted && outputStrides[1] === 1) {
        const rows = outputShape[0], columns = outputShape[1];
        const transpose = new Float64Array(rightItems.length);
        for (let k = 0; k < contracted; k++) for (let j = 0; j < columns; j++)
            transpose[j * contracted + k] = rightItems[k * columns + j];
        const result = new Float64Array(size);
        for (let i = 0; i < rows; i++) {
            checkpoint('computing linear algebra');
            let j = 0;
            ${style==='quad'?`for (; j + 3 < columns; j += 4) {
                let s0=0,s1=0,s2=0,s3=0;
                const offset=i*contracted,b0=j*contracted,b1=b0+contracted,b2=b1+contracted,b3=b2+contracted;
                for (let k=0;k<contracted;k++) {
                    const a=leftItems[offset+k];
                    s0+=a*transpose[b0+k];s1+=a*transpose[b1+k];
                    s2+=a*transpose[b2+k];s3+=a*transpose[b3+k];
                }
                result[i*columns+j]=s0;result[i*columns+j+1]=s1;
                result[i*columns+j+2]=s2;result[i*columns+j+3]=s3;
            }`:''}
            for (;j<columns;j++) {
                let total=0;const a=i*contracted,b=j*contracted;
                for(let k=0;k<contracted;k++)total+=leftItems[a+k]*transpose[b+k];
                result[i*columns+j]=total;
            }
        }
        return result;
    }
`;
writeFileSync(path,source.replace(marker,marker+kernel));
