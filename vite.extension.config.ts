import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function copyExtensionStatic(): Plugin {
  return {
    name: 'copy-extension-static',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: readFileSync(path.resolve(__dirname, 'extension/manifest.json')),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'page-agent.js',
        source: readFileSync(path.resolve(__dirname, 'extension/page-agent.js')),
      });
      // Frozen gold items for extension/eval.html, when scripts/prepare-gold.ts has produced them.
      const goldManifest = path.resolve(__dirname, 'eval/gold/MANIFEST.json');
      if (existsSync(goldManifest)) {
        const raw = readFileSync(goldManifest, 'utf8');
        this.emitFile({ type: 'asset', fileName: 'eval-data/MANIFEST.json', source: raw });
        const splits = (JSON.parse(raw) as { splits?: Record<string, { file: string }> }).splits ?? {};
        for (const entry of Object.values(splits)) {
          const file = path.resolve(__dirname, 'eval/gold', entry.file);
          if (existsSync(file)) this.emitFile({ type: 'asset', fileName: `eval-data/${entry.file}`, source: readFileSync(file) });
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [copyExtensionStatic()],
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    sourcemap: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/extension/background.ts'),
        sidepanel: path.resolve(__dirname, 'extension/sidepanel.html'),
        // Deliberately opened developer page for real local-model evaluation runs (PLAN.md section 7).
        eval: path.resolve(__dirname, 'extension/eval.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
