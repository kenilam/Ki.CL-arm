import {
  DROP,
  FORE,
  JOINTS,
  PIVOT,
  UPPER,
  forward,
  wrap,
  type Pose,
  type Target,
} from 'arm/robot';

/*
 * Closed-form inverse kinematics for the palletizer. The pad always faces
 * straight down, so a pad pose is a point and a yaw: the base turns to the
 * point, the shoulder and elbow solve a two-link triangle in that vertical
 * plane, the wrist cancels their pitch, and the flange turns the pad to the
 * yaw.
 */

const within = (pose: Pose) =>
  JOINTS.every(
    ({ max, min, name }) => pose[name] >= min - 1e-9 && pose[name] <= max + 1e-9
  );

/** The pose that puts the pad's face at `at` with yaw `yaw`, or null when out of reach. */
const inverse = ({ at, yaw }: Target): Pose | null => {
  const base = Math.atan2(-at.z, at.x);
  const du = Math.hypot(at.x, at.z) - PIVOT.u;
  const dv = at.y + DROP - PIVOT.v;
  const reach = Math.hypot(du, dv);
  const cosine =
    (reach * reach - UPPER * UPPER - FORE * FORE) / (2 * UPPER * FORE);

  if (cosine < -1 || cosine > 1) {
    return null;
  }

  // Elbow up: the upper arm sits above the line from shoulder to wrist.
  const bend = Math.acos(cosine);
  const upper =
    Math.atan2(dv, du) +
    Math.atan2(FORE * Math.sin(bend), UPPER + FORE * Math.cos(bend));
  const shoulder = upper - Math.PI / 2;
  const fore = upper - bend;
  const pose: Pose = {
    base,
    shoulder,
    elbow: fore - shoulder,
    wrist: -fore,
    flange: wrap(yaw - base),
  };

  return within(pose) ? pose : null;
};

export { forward, inverse, wrap, type Target };
