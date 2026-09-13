const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// SVG definition for CashPilot icon
// Matches exactly: rounded squircle (rounded-2xl) with sky-600 to sky-500 gradient + white Lucide Compass
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="cpGradient" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>
  <!-- Background squircle -->
  <rect width="512" height="512" rx="115" ry="115" fill="url(#cpGradient)" />
  <!-- CashPilot Compass symbol -->
  <g transform="translate(256, 256) scale(12.5) translate(-12, -12)" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
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
