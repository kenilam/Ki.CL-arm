import {
  create,
  fromBinary,
  toBinary,
  type MessageInitShape,
} from '@bufbuild/protobuf';

import type { Commands, Seen, Sensors, ToBrains } from 'arm/frames';

import {
  Attach_Robot,
  FromBridgeSchema,
  type Joints,
  type SensorsSchema,
  Seen_Kind,
  ToBridgeSchema,
} from './gen/kicl/robot/v1/robot_pb';

/*
 * The floor's frames to and from the bridge's protobuf, generated from
 * Ki.CL-arm's `proto/` with `make codegen`. The frames stay the floor's own
 * types; this is the only place that knows the wire.
 */

const joints = ({ base, elbow, flange, shoulder, wrist }: Joints) => ({
  base,
  elbow,
  flange,
  shoulder,
  wrist,
});

const seen = (item: Seen) => ({
  ...item,
  kind: item.kind === 'case' ? Seen_Kind.CASE : Seen_Kind.PALLET,
  waiting: item.waiting ?? false,
  held: item.held ?? false,
});

const sensors = (
  frame: Sensors
): MessageInitShape<typeof SensorsSchema>['robot'] =>
  frame.robot === 'arm'
    ? {
        case: 'arm',
        value: {
          position: frame.position,
          velocity: frame.velocity,
          gripper: frame.gripper,
          vision: frame.vision.map(seen),
          intrusion: frame.intrusion,
        },
      }
    : {
        case: 'amr',
        value: {
          ...frame.position,
          heading: frame.heading,
          lifted: frame.lifted,
          loaded: frame.loaded,
          proximity: frame.proximity,
          task: frame.task ?? undefined,
        },
      };

const message = (
  message: ToBrains
): MessageInitShape<typeof ToBridgeSchema>['message'] => {
  if (message.type === 'attach') {
    return {
      case: 'attach',
      value: {
        id: message.id,
        robot: message.robot === 'arm' ? Attach_Robot.ARM : Attach_Robot.AMR,
        blocked:
          message.robot === 'amr'
            ? message.config.blocked.map((key) => {
                const [q, r] = key.split(',').map(Number);

                return { q, r };
              })
            : [],
        handover: message.handover
          ? { ...message.handover, held: message.handover.held ?? '' }
          : undefined,
      },
    };
  }

  if (message.type === 'detach') {
    return { case: 'detach', value: { id: message.id } };
  }

  return {
    case: 'sensors',
    value: {
      frames: message.frames.map((frame) => ({
        id: frame.id,
        tick: frame.tick,
        time: frame.time,
        robot: sensors(frame),
      })),
    },
  };
};

/** Fresh bytes on their own buffer, which is what a socket can send. */
const encode = (to: ToBrains) =>
  toBinary(
    ToBridgeSchema,
    create(ToBridgeSchema, { message: message(to) })
  ) as Uint8Array<ArrayBuffer>;

const decode = (bytes: Uint8Array): Commands[] =>
  fromBinary(FromBridgeSchema, bytes).commands.flatMap(
    ({ id, robot, tick }): Commands[] => {
      if (robot.case === 'arm' && robot.value.target) {
        return [
          {
            robot: 'arm',
            id,
            tick,
            target: joints(robot.value.target),
            vacuum: robot.value.vacuum,
          },
        ];
      }

      if (robot.case === 'amr') {
        const { done, lift, speed, turn } = robot.value;

        return [
          { robot: 'amr', id, tick, speed, turn, lift, done: done || null },
        ];
      }

      return [];
    }
  );

export { decode, encode };
