import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { distance, hex, key } from 'arm/grid';

import { route } from './route';

describe('route', () => {
  it('goes straight when nothing is in the way', () => {
    const path = route(hex(0, 0), hex(4, 0), new Set());

    assert.equal(path?.length, 5);
  });

  it('goes round a wall', () => {
    const wall = new Set([-2, -1, 0, 1, 2].map((r) => key(hex(2, r))));
    const path = route(hex(0, 0), hex(4, 0), wall);

    assert.ok(path);
    assert.ok(path.length > 5);
    path.forEach((one) => assert.equal(wall.has(key(one)), false));
    path
      .slice(1)
      .forEach((one, index) => assert.equal(distance(one, path[index]), 1));
  });

  it('enters a blocked goal but never passes through one', () => {
    const blocked = new Set([key(hex(2, 0)), key(hex(3, 0))]);
    const path = route(hex(0, 0), hex(3, 0), blocked);

    assert.ok(path);
    assert.deepEqual(path.at(-1), hex(3, 0));
    assert.equal(
      path.some((one) => key(one) === key(hex(2, 0))),
      false
    );
  });

  it('gives up when the goal is walled in', () => {
    const ring = new Set(
      [hex(4, 0), hex(4, -1), hex(3, -1), hex(2, 0), hex(2, 1), hex(3, 1)].map(
        key
      )
    );

    assert.equal(route(hex(0, 0), hex(3, 0), ring, 500), null);
  });
});
