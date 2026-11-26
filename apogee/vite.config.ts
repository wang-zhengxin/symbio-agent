import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const apogeeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(apogeeDir, '..');

const OFFICE_3D_FILES = [
  'office-scene.js',
  'office-model.js',
  'office-walls.js',
  'office-figure.js',
  'office-avatars.js',
  'office-presence.js',
  'office-furniture.js',
];

function copyOffice3dAssets(): Plugin {
  return {
    name: 'copy-office-3d-assets',
    closeBundle() {
      if (process.env.VITE_PAGES_BUNDLE !== '1') return;
      const outDir = resolve(apogeeDir, 'dist');
      const vendorDir = resolve(outDir, 'office-vendor');
      mkdirSync(vendorDir, { recursive: true });

      for (const file of OFFICE_3D_FILES) {
        copyFileSync(resolve(repoRoot, 'public', file), resolve(outDir, file));
      }

      copyFileSync(
        resolve(repoRoot, 'node_modules/three/build/three.module.min.js'),
        resolve(vendorDir, 'three.module.min.js'),
      );
      copyFileSync(
        resolve(repoRoot, 'node_modules/three/build/three.core.min.js'),
        resolve(vendorDir, 'three.core.min.js'),
      );
      const orbitControls = readFileSync(
        resolve(repoRoot, 'node_modules/three/examples/jsm/controls/OrbitControls.js'),
        'utf8',
      ).replace("from 'three'", "from './three.module.min.js'");
      writeFileSync(resolve(vendorDir, 'OrbitControls.js'), orbitControls, 'utf8');
      writeFileSync(resolve(outDir, '.nojekyll'), '', 'utf8');
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), copyOffice3dAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
