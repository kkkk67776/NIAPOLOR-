import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

const DARK_LOGO_PATH = '/assets/aistudio/file_000000003d20821088780f690ee97fed_f8e408f8.png';
const CORE_BRAND_IMAGES = [
  '/assets/images/echox-logo.webp',
  DARK_LOGO_PATH,
  '/assets/images/hero_echox_tunisia_store.webp',
  '/assets/images/product_drill_cordless_pro.webp',
  '/assets/images/product_automotive_headlight.webp',
  '/assets/images/product_digital_multimeter.webp',
  '/manifest.webmanifest',
  '/pwa-any-192-v2.png',
  '/pwa-any-192-v2.webp',
  '/pwa-any-512-v2.png',
  '/pwa-any-512-v2.webp',
  '/pwa-maskable-192-v2.png',
  '/pwa-maskable-512-v2.png',
  '/apple-touch-icon-v2.png',
];

function collectDistFiles(rootDir: string, currentDir: string, out: string[] = []): string[] {
  if (!fs.existsSync(currentDir)) return out;
  for (const entry of fs.readdirSync(currentDir, {withFileTypes: true})) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectDistFiles(rootDir, full, out);
    } else if (entry.isFile()) {
      const rel = `/${path.relative(rootDir, full).replace(/\\/g, '/')}`;
      out.push(rel);
    }
  }
  return out;
}

function buildPrecacheManifest(distDir: string) {
  const allFiles = collectDistFiles(distDir, distDir).sort();
  const hash = crypto.createHash('sha256');

  const coreSet = new Set<string>(['/', '/index.html', '/manifest.webmanifest']);
  const optionalSet = new Set<string>();

  for (const rel of allFiles) {
    if (rel === '/sw.js' || rel === '/sw-precache.json' || rel === '/_headers' || rel === '/_redirects') {
      continue;
    }
    if (rel.startsWith('/assets/') && /\.(js|css)$/i.test(rel)) {
      coreSet.add(rel);
      const stat = fs.statSync(path.join(distDir, rel.slice(1)));
      hash.update(`${rel}:${stat.size}:`);
    } else if (
      rel === '/assets/images/echox-logo.webp' ||
      rel === DARK_LOGO_PATH ||
      rel === '/pwa-any-192-v2.png' ||
      rel === '/pwa-any-512-v2.png' ||
      rel === '/apple-touch-icon-v2.png'
    ) {
      coreSet.add(rel);
      const stat = fs.statSync(path.join(distDir, rel.slice(1)));
      hash.update(`${rel}:${stat.size}:`);
    } else if (
      rel.startsWith('/assets/images/') ||
      /^\/(pwa-|apple-touch-icon).*\.(png|webp)$/i.test(rel)
    ) {
      optionalSet.add(rel);
      const stat = fs.statSync(path.join(distDir, rel.slice(1)));
      hash.update(`${rel}:${stat.size}:`);
    }
  }

  // Ensure index.html size/hash affects build version too
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    hash.update(fs.readFileSync(indexHtmlPath));
  }

  const version = `echox-${hash.digest('hex').slice(0, 12)}`;
  return {
    version,
    generatedAt: new Date().toISOString(),
    shell: ['/', '/index.html'],
    core: Array.from(coreSet),
    optional: Array.from(optionalSet),
  };
}

function echoxSwPrecachePlugin(): Plugin {
  let outDir = path.resolve(__dirname, 'dist');
  return {
    name: 'echox-sw-precache-manifest',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir || 'dist');
    },
    configureServer(server) {
      server.middlewares.use('/sw-precache.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.end(
          JSON.stringify({
            version: 'echox-dev-v3',
            generatedAt: new Date().toISOString(),
            shell: ['/', '/index.html'],
            core: ['/', '/index.html', '/src/main.tsx', '/src/index.css', ...CORE_BRAND_IMAGES.slice(0, 3), '/manifest.webmanifest', '/pwa-any-192-v2.png'],
            optional: CORE_BRAND_IMAGES.slice(3),
          })
        );
      });
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      const manifest = buildPrecacheManifest(outDir);
      fs.writeFileSync(path.join(outDir, 'sw-precache.json'), JSON.stringify(manifest, null, 2), 'utf8');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), echoxSwPrecachePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      'import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID': JSON.stringify('ai-studio-echoxstore-9e1d54e8-7960-44b2-951a-524166c61a13'),
      'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': JSON.stringify('G-LLXC1GEL75'),
    },
    build: {
      // Never ship source maps: they would expose the original, readable source code.
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Split heavy vendor SDKs cleanly for faster storefront mobile caching
          codeSplitting: {
            groups: [
              {
                name: 'firebase',
                test: /node_modules[\\/]firebase|node_modules[\\/]@firebase/,
              },
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom|react-router|scheduler)/,
              },
              {
                name: 'motion',
                test: /node_modules[\\/](motion|framer-motion|lucide-react)/,
              },
            ],
          },
          // Aggressive minification + identifier mangling to make the shipped code hard to read,
          // and strip console/debugger statements that can leak internal details.
          minify: {
            compress: { dropConsole: true, dropDebugger: true },
            mangle: { toplevel: true },
          },
          // Hashed, non-descriptive chunk names (no original file/module names in the output).
          entryFileNames: 'assets/[hash].js',
          chunkFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash][extname]',
        },
      },
    },
    server: {
      // Strictly allow AI Studio Cloud Run preview hosts (*.run.app) and localhost only.
      allowedHosts: ['.run.app', 'localhost', '127.0.0.1'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
