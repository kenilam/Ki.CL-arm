import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { Commands, Sensors } from 'arm/frames';
import { DELAY, jitter } from './jitter';
import { decode, encode } from './wire';
import {
  FromBridgeSchema,
  ToBridgeSchema,
} from './wire/gen/kicl/robot/v1/robot_pb';

const pose = {
  base: 0.5,
  shoulder: -0.25,
  elbow: 0.75,
  wrist: -0.5,
  flange: 1,
};

const arm: Sensors = {
  robot: 'arm',
  id: 'arm-0',
  tick: 12,
  time: 0.24,
  position: pose,
  velocity: { ...pose, base: 0 },
  gripper: { vacuum: true, contact: true, payload: 8 },
  vision: [
    {
      id: 'case-1',
      kind: 'case',
      top: { x: 1.5, y: 1, z: 0.25 },
      width: 0.5,
      depth: 0.25,
      height: 0.25,
      yaw: 0,
      held: true,
    },
  ],
  intrusion: false,
};

const command = (id: string, tick: number): Commands => ({
  robot: 'arm',
  id,
  tick,
  target: pose,
  vacuum: false,
});

describe('wire', () => {
  it('carries a sensor batch as the bridge reads it', () => {
    const read = fromBinary(
      ToBridgeSchema,
      encode({ type: 'sensors', frames: [arm] })
    );

    assert.equal(read.message.case, 'sensors');

    const [frame] =
      read.message.case === 'sensors' ? read.message.value.frames : [];

    assert.equal(frame.id, 'arm-0');
    assert.equal(frame.tick, 12);
    assert.equal(frame.robot.case, 'arm');
    assert.deepEqual(
      frame.robot.case === 'arm' ? frame.robot.value.position?.base : null,
      0.5
    );
  });

  it('sends an AMR its map as hexes', () => {
    const read = fromBinary(
      ToBridgeSchema,
      encode({
        type: 'attach',
        robot: 'amr',
        id: 'amr-0',
        config: { blocked: ['1,-2', '0,3'] },
      })
    );

    assert.equal(read.message.case, 'attach');
    assert.deepEqual(
      read.message.case === 'attach'
        ? read.message.value.blocked.map(({ q, r }) => [q, r])
        : [],
      [
        [1, -2],
        [0, 3],
      ]
    );
  });

  it('reads the bridge’s commands back as the floor’s', () => {
    const bytes = toBinary(
      FromBridgeSchema,
      create(FromBridgeSchema, {
        commands: [
          {
            id: 'arm-0',
            tick: 12,
            robot: { case: 'arm', value: { target: pose, vacuum: true } },
          },
          {
            id: 'amr-0',
            tick: 12,
            robot: { case: 'amr', value: { speed: 0, turn: 0, lift: true } },
          },
        ],
      })
    );

    assert.deepEqual(decode(bytes), [
      { robot: 'arm', id: 'arm-0', tick: 12, target: pose, vacuum: true },
      {
        robot: 'amr',
        id: 'amr-0',
        tick: 12,
        speed: 0,
        turn: 0,
        lift: true,
        done: null,
      },
    ]);
  });
});

describe('jitter', () => {
  it('holds longer on a slow link, so commands stop arriving late', () => {
    const buffer = jitter();

    // Every command arrives five ticks after the frame it answers, as over a tunnel.
    for (let tick = 0; tick < 200; tick++) {
      buffer.push([command('arm-0', tick)], tick + 5);
      buffer.take(tick + 5);
    }

    const before = buffer.counts().late;

    for (let tick = 200; tick < 260; tick++) {
      buffer.push([command('arm-0', tick)], tick + 5);
      buffer.take(tick + 5);
    }

    assert.equal(buffer.counts().delay, 6);
    assert.equal(
      buffer.counts().late,
      before,
      'still late once the hold fits the link'
    );
  });

  it('holds commands back a few ticks, then releases the newest', () => {
    const buffer = jitter();

    buffer.push([command('arm-0', 10), command('arm-0', 11)], 11);

    assert.deepEqual(buffer.take(10 + DELAY - 1), []);
    assert.equal(buffer.take(11 + DELAY)[0]?.tick, 11);
    assert.deepEqual(buffer.take(11 + DELAY), []);
  });

  it('counts a command that comes after its slot, and drops one older than the last released', () => {
    const buffer = jitter();

    // Ten ticks behind a floor still holding two: late. The hold grows to fit, and the command applies once it is due.
    buffer.push([command('arm-0', 10)], 20);
    assert.equal(buffer.counts().late, 1);
    assert.equal(buffer.take(10 + buffer.counts().delay)[0]?.tick, 10);

    // Older than the one just released: dropped.
    buffer.push([command('arm-0', 9)], 30);
    assert.equal(buffer.counts().dropped, 1);
  });
});
