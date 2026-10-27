import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { forward } from './forward';
import type { Pose } from './spec';
import { urdf } from './urdf';

type Matrix = number[][];

const multiply = (a: Matrix, b: Matrix) =>
  a.map((row) =>
    b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0))
  );

const translate = ([x, y, z]: number[]): Matrix => [
  [1, 0, 0, x],
  [0, 1, 0, y],
  [0, 0, 1, z],
  [0, 0, 0, 1],
];

/** Rotation by `angle` about a unit axis, Rodrigues' formula. */
const rotate = ([x, y, z]: number[], angle: number): Matrix => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0],
    [0, 0, 0, 1],
  ];
};

const numbers = (text: string) => text.split(' ').map(Number);

/** Where the URDF puts the pad for a pose, walking its joints in order. */
const padOf = (pose: Pose) => {
  const joints = [
    ...urdf().matchAll(/<joint name="(\w+)" type="(\w+)">([\s\S]*?)<\/joint>/g),
  ];

  return joints.reduce<Matrix>(
    (frame, [, name, type, body]) => {
      const origin = numbers(/<origin xyz="([^"]+)"/.exec(body)![1]);
      const placed = multiply(frame, translate(origin));

      if (type !== 'revolute') {
        return placed;
      }

      const axis = numbers(/<axis xyz="([^"]+)"/.exec(body)![1]);

      return multiply(placed, rotate(axis, pose[name as keyof Pose]));
    },
    translate([0, 0, 0])
  );
};

describe('urdf', () => {
  it('puts the pad where the floor does, turned z-up', () => {
    [
      { base: 0, shoulder: 0.3, elbow: 0.6, wrist: -0.9, flange: 0 },
      { base: 1.1, shoulder: -0.7, elbow: 0.2, wrist: 0.5, flange: 0.4 },
      { base: -2.4, shoulder: 0.1, elbow: -0.8, wrist: 0.7, flange: -1.3 },
    ].forEach((pose) => {
      const pad = padOf(pose);
      const { at } = forward(pose);

      // Spec (x, y, z) is URDF (x, -z, y).
      [at.x, -at.z, at.y].forEach((value, row) =>
        assert.ok(
          Math.abs(pad[row][3] - value) < 1e-5,
          `${row}: ${pad[row][3]} vs ${value}`
        )
      );
    });
  });
});
