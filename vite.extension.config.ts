import { readFileSync } from 'node:fs';
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
