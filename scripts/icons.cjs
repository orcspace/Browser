const sharp = require('sharp');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
(async () => {
  await sharp('assets/icon.svg').resize(1024).png().toFile('assets/icon.png');
  const pngToIco = (await import('png-to-ico')).default;
  fs.writeFileSync('assets/icon.ico', await pngToIco('assets/icon.png'));
  // iconutil is supplied by macOS. Use its native ICNS encoder for distribution.
  if (process.platform === 'darwin') {
    fs.mkdirSync('assets/browser.iconset', { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) await sharp('assets/icon.svg').resize(size * scale).png().toFile(`assets/browser.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
    }
    execFileSync('iconutil', ['-c', 'icns', 'assets/browser.iconset', '-o', 'assets/icon.icns']);
    fs.rmSync('assets/browser.iconset', { recursive: true });
  }
})();
