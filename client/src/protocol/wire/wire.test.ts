import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// Protocol
import type { Command, Report } from '..';

// Partials
import {
  decodeReport,
  decodeToArm,
  encodeReport,
  encodeToArm,
  type ToArm,
} from '.';

const ARM = 'arm-1';

const COMMANDS: Command[] = [
  {
    type: 'load',
    arm: ARM,
    plan: {
      arm: ARM,
      revision: 3,
      holding: 'case-7',
      known: ['post', 'rail'],
      instructions: [
        {
          do: 'move',
          to: { at: { x: 0.2, y: 1.6, z: 1 }, facing: Math.PI / 2 },
          ease: 'swing',
        },
        {
          do: 'move',
          to: { at: { x: -0.5, y: 0.3, z: 1.2 }, facing: 0 },
          ease: 'arrive',
        },
        { do: 'pick', case: 'case-8' },
        { do: 'wait', seconds: 0.25 },
        { do: 'gate', id: 'belt-a' },
        { do: 'place', case: 'case-8' },
      ],
    },
  },
  {
    type: 'load',
    arm: ARM,
    plan: { arm: ARM, revision: 4, holding: null, known: [], instructions: [] },
  },
  { type: 'hold', arm: ARM },
  { type: 'resume', arm: ARM },
  { type: 'stop', arm: ARM },
  { type: 'reset', arm: ARM },
  { type: 'open', arm: ARM, gate: 'belt-a' },
];

const REPORTS: Report[] = [
  {
    type: 'telemetry',
    arm: ARM,
    at: 12.5,
    state: 'running',
    revision: 3,
    step: 2,
    joints: {
      yaw: 0.1,
      shoulder: 0.2,
      elbow: 0.3,
      wrist: 0.4,
      roll: 0.5,
      grip: 1,
    },
    pad: { at: { x: 0.2, y: 1.6, z: 1 }, facing: 0.75 },
    holding: 'case-8',
  },
  {
    type: 'telemetry',
    arm: ARM,
    at: 0,
    state: 'idle',
    revision: null,
    step: 0,
    joints: { yaw: 0, shoulder: 0, elbow: 0, wrist: 0, roll: 0, grip: 0 },
    pad: { at: { x: 0, y: 0, z: 0 }, facing: 0 },
    holding: null,
  },
  { type: 'loaded', arm: ARM, revision: 3 },
  { type: 'rejected', arm: ARM, revision: 3, reason: 'holding case-7' },
  { type: 'progress', arm: ARM, revision: 3, step: 1 },
  { type: 'done', arm: ARM, revision: 3 },
  { type: 'held', arm: ARM, cause: 'sensor', seen: ['post'] },
  { type: 'held', arm: ARM, cause: 'command', seen: [] },
  { type: 'resumed', arm: ARM },
  { type: 'stopped', arm: ARM },
  { type: 'reset', arm: ARM },
];

describe('wire', () => {
  test('every command comes back as it went', () => {
    COMMANDS.forEach((command) =>
      assert.deepEqual(decodeToArm(encodeToArm(command)), command)
    );
  });

  test('a scene comes back as it went', () => {
    const scene: ToArm = {
      type: 'scene',
      arm: ARM,
      boxes: [
        {
          id: 'post',
          min: { x: -1, y: 0, z: 2 },
          max: { x: -0.8, y: 2, z: 2.2 },
        },
      ],
    };

    assert.deepEqual(decodeToArm(encodeToArm(scene)), scene);
  });

  test('every report comes back as it went', () => {
    REPORTS.forEach((report) =>
      assert.deepEqual(decodeReport(encodeReport(report)), report)
    );
  });

  test('a telemetry frame is well under the JSON', () => {
    const bytes = encodeReport(REPORTS[0]).byteLength;
    const json = JSON.stringify(REPORTS[0]).length;

    assert.ok(bytes < json * 0.6, `${bytes} bytes against ${json} of JSON`);
  });

  test('an empty frame is refused', () => {
    assert.throws(() => decodeToArm(new Uint8Array()));
    assert.throws(() => decodeReport(new Uint8Array()));
  });
});
