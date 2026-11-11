import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adjacentCentres,
  centreOf,
  contains,
  distance,
  fromPoint,
  hex,
  isCentre,
  key,
  members,
  range,
  toPoint,
} from '.';

describe('hex', () => {
  it('finds the hex under its own centre', () => {
    range(hex(0, 0), 6).forEach((one) => {
      assert.deepEqual(fromPoint(toPoint(one)), one);
    });
  });

  it('counts steps between hexes', () => {
    assert.equal(distance(hex(0, 0), hex(3, -1)), 3);
    assert.equal(range(hex(0, 0), 2).length, 19);
  });
});

describe('cell', () => {
  it('puts every hex in exactly one cell', () => {
    const owners = new Map<string, string>();

    range(hex(0, 0), 8)
      .filter(isCentre)
      .forEach((centre) => {
        members(centre).forEach((member) => {
          assert.equal(owners.has(key(member)), false, key(member));
          owners.set(key(member), key(centre));
        });
      });

    range(hex(0, 0), 6).forEach((one) => {
      assert.equal(owners.get(key(one)), key(centreOf(one)), key(one));
    });
  });

  it('says whether a hex is inside a cell', () => {
    const centre = hex(0, 0);

    members(centre).forEach((member) => assert.ok(contains(centre, member)));
    assert.equal(contains(centre, hex(2, 0)), false);
  });

  it('knows the neighbouring cells', () => {
    adjacentCentres(hex(0, 0)).forEach((centre) => {
      assert.ok(isCentre(centre));
      assert.equal(distance(hex(0, 0), centre), 3);
    });
  });
});
