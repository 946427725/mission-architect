// Builds the Windows desktop app: single-file game -> desktop/app -> portable .exe
// Usage: npm run build:exe   (after npm install inside desktop/)
import { copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const desktop = join(root, 'desktop');
mkdirSync(join(desktop, 'app'), { recursive: true });
copyFileSync(join(root, 'single', 'index.html'), join(desktop, 'app', 'index.html'));
copyFileSync(join(desktop, 'icon.png'), join(desktop, 'app', 'icon.png'));
execSync('npx electron-builder --win portable --x64 --config.directories.output=dist-exe', { cwd: desktop, stdio: 'inherit' });
console.log('Windows build ready in desktop/dist-exe/');
