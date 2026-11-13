import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, drawPixel) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // CRC table
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const chunkType = Buffer.from(type, 'ascii');
    const typeAndData = Buffer.concat([chunkType, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
  }

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw image data with row filter 0
  const rowStride = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowStride);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawData[rowOffset] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Luna stylish AI icon: sleek dark circle with violet-pink glowing gradient orb & 'L'
function renderLunaIcon(x, y, w, h, isMaskable = false) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = w * (isMaskable ? 0.38 : 0.44);

  // Background
  if (isMaskable) {
    // Fill full background for maskable
    const bgGrad = y / h;
    const r = Math.floor(10 + bgGrad * 15);
    const g = Math.floor(5 + bgGrad * 5);
    const b = Math.floor(25 + bgGrad * 20);
    // Add central glow
    const glow = Math.max(0, 1 - dist / (w * 0.45));
    const finalR = Math.min(255, Math.floor(r + glow * 120));
    const finalG = Math.min(255, Math.floor(g + glow * 40));
    const finalB = Math.min(255, Math.floor(b + glow * 180));
    
    // Draw simple 'L'
    const nx = (x - cx) / (w * 0.28);
    const ny = (y - cy) / (h * 0.28);
    if (inLShape(nx, ny)) {
      return [255, 255, 255, 255];
    }
    return [finalR, finalG, finalB, 255];
  } else {
    // Transparent outside circle
    if (dist > radius) {
      return [0, 0, 0, 0];
    }
    // Gradient inside circle: Violet to Pink
    const t = (x + y) / (w + h);
    const r = Math.floor(139 + t * (236 - 139));
    const g = Math.floor(92 + t * (72 - 92));
    const b = Math.floor(246 + t * (153 - 246));

    const nx = (x - cx) / (w * 0.3);
    const ny = (y - cy) / (h * 0.3);
    if (inLShape(nx, ny)) {
      return [255, 255, 255, 255];
    }
    return [r, g, b, 255];
  }
}

function inLShape(nx, ny) {
  // nx, ny from -1 to 1
  // Vertical stem: nx between -0.6 and -0.2, ny between -0.7 and 0.7
  if (nx >= -0.6 && nx <= -0.2 && ny >= -0.7 && ny <= 0.7) return true;
  // Bottom bar: ny between 0.3 and 0.7, nx between -0.6 and 0.6
  if (ny >= 0.3 && ny <= 0.7 && nx >= -0.6 && nx <= 0.6) return true;
  return false;
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Generate 192x192
const png192 = createPNG(192, 192, (x, y, w, h) => renderLunaIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), png192);

// 2. Generate 512x512
const png512 = createPNG(512, 512, (x, y, w, h) => renderLunaIcon(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), png512);

// 3. Generate Maskable 512x512
const pngMaskable = createPNG(512, 512, (x, y, w, h) => renderLunaIcon(x, y, w, h, true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pngMaskable);

// 4. Generate Apple Touch Icon 180x180
const png180 = createPNG(180, 180, (x, y, w, h) => renderLunaIcon(x, y, w, h, true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180);

// 5. Generate public/icon.svg
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#ec4899" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="#050505"/>
  <circle cx="256" cy="256" r="200" fill="url(#grad)" opacity="0.95"/>
  <path d="M 160 170 H 352 L 200 342 H 352" fill="none" stroke="#ffffff" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg);

console.log('Successfully generated all PWA icons in /public!');
