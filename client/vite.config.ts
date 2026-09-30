import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/*
 * The arm's business logic as a Module Federation remote named `arm`, the
 * way Ki.CL-back serves its GraphQL client as `api`. No React in here and
 * nothing shared with the host: the hub and each controller run in workers,
 * and the page only talks to them through messages.
 *
 * Served at /arm/* - base must match so chunk and worker URLs resolve. The
 * host proxies that path onto its own origin, which is what lets the page
 * start the workers: a worker script has to be same-origin.
 */
export default defineConfig({
  root,
  base: '/arm/',
  plugins: [
    federation({
      name: 'arm',
      filename: 'remoteEntry.js',
      // One entry per module the floor imports, under the path it imports it by.
      exposes: {
        './protocol': './src/protocol/index.ts',
        './grid/child': './src/grid/child.ts',
        './grid/hex': './src/grid/hex.ts',
        './grid/layout': './src/grid/layout.ts',
        './model/constants': './src/model/constants.ts',
        './model/kinematics': './src/model/kinematics.ts',
        './station/events': './src/station/events.ts',
        './station/spec': './src/station/spec.ts',
        './hub': './src/hub/index.ts',
        './floor': './src/floor/index.ts',
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
    emptyOutDir: true,
    modulePreload: false,
  },
  worker: {
    format: 'es',
  },
});
