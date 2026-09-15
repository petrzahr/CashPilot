const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// SVG definition for CashPilot icon
// Wallet silhouette on the existing sky-600 to sky-500 brand gradient.
// Broad shapes keep the wallet and clasp legible at 16px; all surfaces use this source.
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="cpGradient" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>
  <!-- Background squircle -->
  <rect width="512" height="512" rx="115" ry="115" fill="url(#cpGradient)" />
  <!-- CashPilot wallet: folded top, solid body, contrasting clasp -->
  <g id="wallet">
    <path d="M128 176v-16a32 32 0 0 1 26-31l172-33a20 20 0 0 1 24 20v44H160a32 32 0 0 0-32 16Z" fill="#ffffff" />
    <rect x="112" y="184" width="288" height="208" rx="40" fill="#ffffff" />
    <path d="M328 248h72v80h-72a40 40 0 0 1 0-80Z" fill="#0284c7" />
    <circle cx="328" cy="288" r="12" fill="#ffffff" />
  </g>
</svg>
`;

// Write SVG
const svgPath = path.join(publicDir, 'favicon.svg');
fs.writeFileSync(svgPath, svgContent.trim(), 'utf8');
console.log('Saved:', svgPath);

// Generate PNG sizes: 16x16, 32x32, 180x180, 192x192, 512x512
const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-192x192.png', size: 192 },
  { name: 'favicon-512x512.png', size: 512 },
];

async function generatePngs() {
  const svgBuffer = Buffer.from(svgContent);
  for (const { name, size } of sizes) {
    const dest = path.join(publicDir, name);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(dest);
    console.log(`Generated ${name} (${size}x${size})`);
  }
}

generatePngs().catch((err) => {
  console.error('Error generating PNGs:', err);
  process.exit(1);
});
