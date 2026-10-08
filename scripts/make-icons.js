// Genera assets/icon.png y los assets de Discord (nsw2.png, nsw1.png) a partir de SVG.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function console2({ bg = '#1d1e20', body = '#26272b', left = '#00c3e3', right = '#ff4554', joy = '#2f3035', full = false }) {
    // Consola genérica: pantalla central + dos mandos laterales con acento de color.
    const joyLeft = full ? left : joy;
    const joyRight = full ? right : joy;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
        <rect width="1024" height="1024" rx="220" fill="${bg}"/>
        <g transform="translate(92 337)">
            <rect x="0" y="0" width="124" height="350" rx="62" fill="${joyLeft}"/>
            ${full ? '' : `<rect x="104" y="28" width="20" height="294" rx="6" fill="${left}"/>`}
            <circle cx="60" cy="100" r="25" fill="${full ? '#00000033' : '#17181b'}"/>
            <rect x="132" y="0" width="576" height="350" rx="30" fill="${body}"/>
            <rect x="158" y="26" width="524" height="298" rx="14" fill="#0d0e10"/>
            <rect x="716" y="0" width="124" height="350" rx="62" fill="${joyRight}"/>
            ${full ? '' : `<rect x="716" y="28" width="20" height="294" rx="6" fill="${right}"/>`}
            <circle cx="780" cy="250" r="25" fill="${full ? '#00000033' : '#17181b'}"/>
            <path d="M380 120 l0 110 l96 -55 z" fill="#ffffff" opacity=".92"/>
        </g>
    </svg>`;
}

async function render(svg, out, size) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
    console.log('✓', path.relative(root, out));
}

await render(console2({}), path.join(root, 'assets', 'icon.png'), 512);
await render(console2({}), path.join(root, 'assets', 'discord', 'nsw2.png'), 1024);
await render(console2({ bg: '#e60012', body: '#3a3b3f', full: true }), path.join(root, 'assets', 'discord', 'nsw1.png'), 1024);
