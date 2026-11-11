import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromBinary } from '@bufbuild/protobuf';

import type { Commands, Sensors } from 'arm/frames';
import { JOINTS } from 'arm/robot';

import { WINDOW, handovers } from './handover';
import { encode } from './wire';
import { ToBridgeSchema } from './wire/gen/kicl/robot/v1/robot_pb';

const pose = { base: 0.4, shoulder: -0.3, elbow: 0.2, wrist: 0.1, flange: 0.6 };

const holding: Sensors = {
  robot: 'arm',
  id: 'arm-0',
  tick: 40,
  time: 0.8,
  position: pose,
  velocity: { base: 0.5, shoulder: 0, elbow: 0, wrist: 0, flange: 0 },
  gripper: { vacuum: true, contact: true, payload: 8 },
  vision: [
    {
      id: 'case-3',
      kind: 'case',
      top: { x: 1, y: 1, z: 0 },
      width: 0.4,
      depth: 0.3,
      height: 0.3,
      yaw: 1,
      held: true,
    },
  ],
  intrusion: false,
};

const command = (
  tick: number,
  change: Partial<typeof pose> = {},
  vacuum = true
): Commands => ({
  robot: 'arm',
  id: 'arm-0',
  tick,
  target: { ...pose, ...change },
  vacuum,
});

describe('handover', () => {
  it('snapshots the joints, the grip and the held case', () => {
    const handing = handovers();

    handing.see([holding]);

    const snapshot = handing.begin('arm-0');

    assert.deepEqual(snapshot?.position, pose);
    assert.equal(snapshot?.vacuum, true);
    assert.equal(snapshot?.held, 'case-3');
    assert.ok(Math.abs((snapshot?.grip ?? 0) - (1 - 1)) < 1e-9);
  });

  it('holds the robot still until the incoming brain answers', () => {
    const handing = handovers();

    handing.see([holding]);
    handing.begin('arm-0');

    const [hold] = handing.guard([], 41);

    assert.equal(hold.robot, 'arm');
    assert.deepEqual(hold.robot === 'arm' && hold.target, pose);
    assert.equal(hold.robot === 'arm' && hold.vacuum, true);
    assert.deepEqual(handing.counts(), { handing: 1, violations: 0 });
  });

  it('refuses a first command that lets go of the case or jumps a joint', () => {
    const handing = handovers();
    const [, shoulder] = JOINTS;

    handing.see([holding]);
    handing.begin('arm-0');

    const letGo = handing.guard([command(42, {}, false)], 42);
    const jump = handing.guard(
      [command(43, { shoulder: pose.shoulder + shoulder.speed * WINDOW * 2 })],
      43
    );

    // Both refused: the robot is told to hold instead.
    [letGo, jump].forEach(([only]) =>
      assert.deepEqual(only.robot === 'arm' && only.target, pose)
    );
    assert.deepEqual(handing.counts(), { handing: 1, violations: 2 });
  });

  it('passes a first command that carries on, and everything after it', () => {
    const handing = handovers();

    handing.see([holding]);
    handing.begin('arm-0');

    const [first] = handing.guard([command(44, { base: 0.42 })], 44);
    const [next] = handing.guard([command(45, {}, false)], 45);

    assert.equal(first.tick, 44);
    assert.equal(next.robot === 'arm' && next.vacuum, false);
    assert.deepEqual(handing.counts(), { handing: 0, violations: 0 });
  });

  it('carries the snapshot to the bridge', () => {
    const handing = handovers();

    handing.see([holding]);

    const read = fromBinary(
      ToBridgeSchema,
      encode({
        type: 'attach',
        robot: 'arm',
        id: 'arm-0',
        handover: handing.begin('arm-0'),
      })
    );

    assert.equal(read.message.case, 'attach');

    const handover =
      read.message.case === 'attach' ? read.message.value.handover : undefined;

    assert.equal(handover?.held, 'case-3');
    assert.equal(handover?.vacuum, true);
    assert.ok(Math.abs((handover?.position?.base ?? 0) - pose.base) < 1e-6);
  });
});
