import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOME, JOINTS, PAD, TOOL } from '../src/robot/spec';
import { rmpflow, urdf, xrdf } from '../src/robot/urdf';

/*
 * Writes the arm for Isaac Sim and cuMotion into sim/robot, from the spec the
 * floor and the classic brain use, with the spec itself as JSON for the
 * twin's planner. `make assets`; commit what it writes.
 */

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sim/robot'
);

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'robot.urdf'), urdf());
writeFileSync(path.join(out, 'robot.xrdf'), xrdf());
writeFileSync(path.join(out, 'rmp_flow.yaml'), rmpflow());
writeFileSync(
  path.join(out, 'spec.json'),
  `${JSON.stringify({ joints: JOINTS, tool: TOOL, pad: PAD, home: HOME }, null, 2)}\n`
);
console.log(`wrote robot.urdf, robot.xrdf, rmp_flow.yaml and spec.json to ${out}`);
