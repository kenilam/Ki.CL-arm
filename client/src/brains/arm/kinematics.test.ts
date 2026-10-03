import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOME } from 'arm/robot';

import { forward, inverse } from './kinematics';

const close = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);

describe('kinematics', () => {
  it('finds the pose for a point it can reach, and back', () => {
    [
      { at: { x: 1.73, y: 1.05, z: 0 }, yaw: 0.3 },
      { at: { x: 1.2, y: 0.45, z: -1.4 }, yaw: -1.2 },
      { at: { x: -0.9, y: 0.6, z: 1.6 }, yaw: 2 },
      { at: { x: 2.3, y: 0.3, z: 0.4 }, yaw: 0 },
    ].forEach((target) => {
      const pose = inverse(target);

      assert.ok(pose, JSON.stringify(target));

      const back = forward(pose);

      close(back.at.x, target.at.x);
      close(back.at.y, target.at.y);
      close(back.at.z, target.at.z);
      close(back.yaw, target.yaw);
    });
  });

  it('keeps the pad facing down', () => {
    const pose = inverse({ at: { x: 1.5, y: 0.8, z: 0.5 }, yaw: 0 });

    assert.ok(pose);
    close(pose.shoulder + pose.elbow + pose.wrist, 0);
  });

  it('refuses a point out of reach', () => {
    assert.equal(inverse({ at: { x: 5, y: 1, z: 0 }, yaw: 0 }), null);
  });

  it('agrees with the home pose', () => {
    const home = forward(HOME);
    const pose = inverse(home);

    assert.ok(pose);
    close(pose.shoulder, HOME.shoulder);
    close(pose.elbow, HOME.elbow);
  });
});
