import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const resources = fileURLToPath(new URL('../android/app/src/main/res/', import.meta.url));
const artwork = `<g transform="translate(54 54) scale(0.72) translate(-54 -54)">
    <path fill="#f1f4ef" fill-rule="evenodd"
        d="M31 26H58C70 26 77 33 77 43C77 52 72 58 64 60L78 82H65L52 61H42V82H31V26ZM42 37V50H58C63 50 66 47 66 43C66 39 63 37 58 37H42Z"/>
    <rect x="79" y="65" width="7" height="7" fill="#80e0a0"/></g>`;
const svg = background => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 108 108">${background}${artwork}</svg>`);
const foreground = svg('');
const square = svg('<rect width="108" height="108" rx="24" fill="#101713"/>');
const round = svg('<circle cx="54" cy="54" r="54" fill="#101713"/>');

for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const directory = `${resources}mipmap-${density}`;
    await mkdir(directory, { recursive: true });
    await Promise.all([
        sharp(foreground).resize(108 * scale).png().toFile(`${directory}/ic_launcher_foreground.png`),
        sharp(square).resize(48 * scale).png().toFile(`${directory}/ic_launcher.png`),
        sharp(round).resize(48 * scale).png().toFile(`${directory}/ic_launcher_round.png`),
    ]);
}
