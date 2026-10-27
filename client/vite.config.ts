import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/*
 * Everything about the robots and their brains, as a Module Federation remote
 * named `arm`, the way Ki.CL-back serves its GraphQL client as `api`. No
 * React and nothing shared with the host: the classic brains run in workers,
 * and the floor only talks to them through frames.
 *
 * Served by the bridge at /arm/client/* - base must match so chunk and worker
 * URLs resolve. Ki.CL proxies /arm onto its own origin, which is what lets the
 * page start the workers: a worker script has to be same-origin.
 */
export default defineConfig({
  root,
  base: '/arm/client/',
  plugins: [
    federation({
      name: 'arm',
      filename: 'remoteEntry.js',
      // One entry per module the floor imports, under the path it imports it by.
      exposes: {
        './brains': './src/brains/index.ts',
        './frames': './src/frames.ts',
        './grid': './src/grid/index.ts',
        './robot': './src/robot/index.ts',
      },
      dts: {
        generateTypes: {
          compileInChildProcess: true,
        },
      },
    }),
  ],
  resolve: {
    // Keep in sync with tsconfig.json paths: "arm/*" → "./src/*"
    alias: {
      arm: path.resolve(root, 'src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // The watch build emits no types, so it must not sweep away the ones the build before it wrote.
    emptyOutDir: !process.argv.includes('--watch'),
    modulePreload: false,
  },
  worker: {
    format: 'es',
  },
});
