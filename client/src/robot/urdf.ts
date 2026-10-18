import { HOME, JOINTS, PAD, TOOL, type Joint } from './spec';

/*
 * The arm for Isaac Sim, written from the same spec the floor draws and the
 * classic brain plans with: a URDF, and the Lula robot description RMPflow
 * reads (joint order, home pose, collision spheres). Isaac is z-up and the
 * spec is y-up, so every vector turns a quarter about x: spec (x, y, z) is
 * URDF (x, -z, y). A pitch joint turns about spec z, which is URDF -y, so
 * its angle keeps the same sign on both sides.
 */

type Vector = Joint['origin'];

const THICKNESS = 0.18;

/** The pad's contact face, in metres: inside the smallest case it lifts. */
const CONTACT = 0.25;

/** Kilograms per metre of link, for PhysX's inertia; the arm's own drives make up the rest. */
const DENSITY = 40;

const LINKS = ['turret', 'upper_arm', 'forearm', 'wrist_link', 'flange_link'];

const toZUp = ([x, y, z]: Vector): Vector => [x, -z, y];

const AXES = { y: '0 0 1', z: '0 -1 0' } as const;

const format = (vector: readonly number[]) =>
  vector.map((value) => Number(value.toFixed(6))).join(' ');

/** The vector from a link's joint to the next joint, or to the pad for the last. */
const reach = (index: number): Vector =>
  toZUp(index + 1 < JOINTS.length ? JOINTS[index + 1].origin : TOOL);

/** A box from the link's origin along `along`, with a mass for its length. */
const bar = (along: Vector) => {
  const [x, , z] = along;
  const length = Math.hypot(...along);
  const mass = Math.max(1, length * DENSITY);
  const pitch = Math.atan2(x, z);
  const middle: Vector = [along[0] / 2, along[1] / 2, along[2] / 2];
  const origin = `<origin xyz="${format(middle)}" rpy="${format([0, pitch, 0])}"/>`;
  const box = `<box size="${format([THICKNESS, THICKNESS, length])}"/>`;
  const inertia = (mass * (length * length + THICKNESS * THICKNESS)) / 12;

  return `
    <visual>${origin}<geometry>${box}</geometry></visual>
    <collision>${origin}<geometry>${box}</geometry></collision>
    <inertial>${origin}<mass value="${mass.toFixed(2)}"/><inertia ixx="${inertia.toFixed(4)}" iyy="${inertia.toFixed(4)}" izz="${((mass * THICKNESS * THICKNESS) / 6).toFixed(4)}" ixy="0" ixz="0" iyz="0"/></inertial>`;
};

const urdf = () => {
  const links = LINKS.map(
    (name, index) => `  <link name="${name}">${bar(reach(index))}
  </link>`
  );
  const joints = JOINTS.map(
    (
      { axis, max, min, name, origin, speed },
      index
    ) => `  <joint name="${name}" type="revolute">
    <parent link="${index ? LINKS[index - 1] : 'base_link'}"/>
    <child link="${LINKS[index]}"/>
    <origin xyz="${format(toZUp(origin))}" rpy="0 0 0"/>
    <axis xyz="${AXES[axis]}"/>
    <limit lower="${min}" upper="${max}" velocity="${speed}" effort="2000"/>
  </joint>`
  );
  const pad = `<box size="${format([PAD.width, PAD.depth, 0.06])}"/>`;
  // The pad touches only what it holds: wider than the case, it would land on the neighbours in the stack.
  const contact = `<box size="${format([CONTACT, CONTACT, 0.06])}"/>`;

  return `<?xml version="1.0"?>
<!-- Generated from client/src/robot/spec.ts by make assets. Do not edit. -->
<robot name="palletizer">
  <link name="base_link">
    <visual><origin xyz="0 0 ${JOINTS[0].origin[1] / 2}"/><geometry><cylinder radius="0.4" length="${JOINTS[0].origin[1]}"/></geometry></visual>
    <collision><origin xyz="0 0 ${JOINTS[0].origin[1] / 2}"/><geometry><cylinder radius="0.4" length="${JOINTS[0].origin[1]}"/></geometry></collision>
    <inertial><mass value="200"/><inertia ixx="10" iyy="10" izz="10" ixy="0" ixz="0" iyz="0"/></inertial>
  </link>
${links.join('\n')}
${joints.join('\n')}
  <link name="pad">
    <visual><origin xyz="0 0 0.03"/><geometry>${pad}</geometry></visual>
    <collision><origin xyz="0 0 0.03"/><geometry>${contact}</geometry></collision>
    <inertial><mass value="2"/><inertia ixx="0.05" iyy="0.05" izz="0.1" ixy="0" ixz="0" iyz="0"/></inertial>
  </link>
  <joint name="pad_joint" type="fixed">
    <parent link="flange_link"/>
    <child link="pad"/>
    <origin xyz="${format(toZUp(TOOL))}" rpy="0 0 0"/>
  </joint>
</robot>
`;
};

/** Spheres along each link, in the link's own frame, so RMPflow keeps the arm off obstacles and itself. */
const spheres = () =>
  LINKS.map((name, index) => {
    const along = reach(index);
    const count = Math.max(2, Math.ceil(Math.hypot(...along) / 0.2) + 1);
    const centres = Array.from(
      { length: count },
      (_, step) =>
        along.map((value) => (value * step) / (count - 1))
    );

    return `      ${name}:\n${centres
      .map(
        (centre) =>
          `        - center: [${format(centre).split(' ').join(', ')}]\n          radius: ${THICKNESS * 0.75}`
      )
      .join('\n')}`;
  }).join('\n');

/** Each link ignores its neighbours, and theirs, for self collision: they touch at every joint. */
const ignores = () =>
  [...LINKS, 'pad']
    .map(
      (name, index, all) =>
        `    ${name}: [${all
          .slice(index + 1, index + 3)
          .map((other) => `"${other}"`)
          .join(', ')}]`
    )
    .filter((line) => !line.endsWith('[]'))
    .join('\n');

/** cuMotion's robot description: the joints it drives, the pose it rests in, the pad as its tool, and the arm's shape. */
const xrdf =
  () => `# Generated from client/src/robot/spec.ts by make assets. Do not edit.
format: xrdf
format_version: 2.0

default_joint_positions:
${JOINTS.map(({ name }) => `  ${name}: ${HOME[name]}`).join('\n')}

cspace:
  joint_names:
${JOINTS.map(({ name }) => `    - "${name}"`).join('\n')}
  acceleration_limits: [${JOINTS.map(() => 10).join(', ')}]
  jerk_limits: [${JOINTS.map(() => 5000).join(', ')}]

tool_frames: ["pad"]

world_collision:
  geometry: "arm_spheres"

self_collision:
  geometry: "arm_spheres"
  ignore:
${ignores()}

geometry:
  arm_spheres:
    spheres:
${spheres()}
`;

/** RMPflow's tuning: NVIDIA's Franka values, with this arm's joint count and its own top speed. */
const rmpflow =
  () => `# Generated from client/src/robot/spec.ts by make assets. Do not edit.
format: rmpflow
api_version: 2.0

joint_limit_buffers: [${JOINTS.map(() => 0.01).join(', ')}]

rmp_params:
    cspace_target_rmp:
        metric_scalar: 50.
        position_gain: 100.
        damping_gain: 50.
        robust_position_term_thresh: .5
        inertia: 1.
    cspace_trajectory_rmp:
        p_gain: 100.
        d_gain: 10.
        ff_gain: .25
        weight: 50.
    cspace_affine_rmp:
        final_handover_time_std_dev: .25
        weight: 2000.
    joint_limit_rmp:
        metric_scalar: 1000.
        metric_length_scale: .01
        metric_exploder_eps: 1e-3
        metric_velocity_gate_length_scale: .01
        accel_damper_gain: 200.
        accel_potential_gain: 1.
        accel_potential_exploder_length_scale: .1
        accel_potential_exploder_eps: 1e-2
    joint_velocity_cap_rmp:
        max_velocity: ${Math.min(...JOINTS.map(({ speed }) => speed))}
        velocity_damping_region: 0.35
        damping_gain: 10.0
        metric_weight: 2000.0
    target_rmp:
        accel_p_gain: 50.
        accel_d_gain: 75.
        accel_norm_eps: .075
        metric_alpha_length_scale: .05
        min_metric_alpha: .03
        max_metric_scalar: 10000
        min_metric_scalar: 5000
        proximity_metric_boost_scalar: 20.
        proximity_metric_boost_length_scale: .02
        accept_user_weights: false
    axis_target_rmp:
        accel_p_gain: 210.
        accel_d_gain: 60.
        metric_scalar: 10
        proximity_metric_boost_scalar: 3000.
        proximity_metric_boost_length_scale: .02
        accept_user_weights: false
    collision_rmp:
        damping_gain: 50.
        damping_std_dev: .04
        damping_robustness_eps: 1e-2
        damping_velocity_gate_length_scale: .01
        repulsion_gain: 800.
        repulsion_std_dev: .01
        metric_modulation_radius: .5
        metric_scalar: 10000.
        metric_exploder_std_dev: .02
        metric_exploder_eps: .001
    point_cloud_obstacle_rmp:
        max_num_obstacles: 1e5
        margin: 0.0
        damping_gain: 15.0
        damping_std_dev: .04
        damping_robustness_eps: 1e-2
        damping_velocity_gate_length_scale: .01
        repulsion_gain: 1.5
        repulsion_std_dev: .01
        metric_modulation_radius: .5
        metric_scalar: 150.0
        metric_exploder_std_dev: .02
        metric_exploder_eps: .001
    damping_rmp:
        accel_d_gain: 30.
        metric_scalar: 50.
        inertia: 3000.

canonical_resolve:
    max_acceleration_norm: 50.
    projection_tolerance: .01
    verbose: false

body_capsules:
    - name: base_link
      pt1: [0, 0, ${JOINTS[0].origin[1]}]
      pt2: [0, 0, 0]
      radius: .4

body_collision_controllers:
    - name: wrist_link
      radius: .12
    - name: flange_link
      radius: .12
`;

export { rmpflow, urdf, xrdf };
