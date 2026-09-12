import sharp from 'sharp';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const { paths, height, width } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    paths: string[];
    height: number;
    width: number;
};
for (const path of paths) {
    const pixels = await sharp(path)
        .rotate()
        .resize(width, height, { fit: 'fill' })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer();
    if (pixels.length !== height * width * 3) {
        throw new Error(`image decoder returned unexpected channels: ${path}`);
    }
    process.stdout.write(pixels);
}
