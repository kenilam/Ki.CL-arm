// Libraries
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

// Protocol
import type { Command } from '../commands';
import type { Box } from '../geometry';
import type { Ease, Instruction, Plan } from '../plan';
import type { Report, State, Telemetry } from '../reports';

// Generated
import * as Pb from './gen/kicl/arm/v1/arm_pb';

/** What is physically around an arm, for a simulated arm's sensors to meet. */
type Scene = { type: 'scene'; arm: string; boxes: Box[] };

/** Everything that goes from the hub to the arms over one socket. */
type ToArm = Command | Scene;

type Cause = Extract<Report, { type: 'held' }>['cause'];

const EASE: Record<Ease, Pb.Ease> = {
  arrive: Pb.Ease.ARRIVE,
  leave: Pb.Ease.LEAVE,
  swing: Pb.Ease.SWING,
};

const STATE: Record<State, Pb.State> = {
  idle: Pb.State.IDLE,
  running: Pb.State.RUNNING,
  held: Pb.State.HELD,
  stopped: Pb.State.STOPPED,
};

const CAUSE: Record<Cause, Pb.Cause> = {
  command: Pb.Cause.COMMAND,
  sensor: Pb.Cause.SENSOR,
};

/** The name for a wire enum's value, or a throw for one the schema doesn't give a name. */
const named = <Name extends string, Value extends number>(
  table: Record<Name, Value>,
  value: Value,
  what: string
) => {
  const found = (Object.keys(table) as Name[]).find(
    (name) => table[name] === value
  );

  if (found === undefined) {
    throw new Error(`Unknown ${what} on the wire: ${value}`);
  }

  return found;
};

const instruction = (one: Instruction): Pb.Instruction => {
  switch (one.do) {
    case 'move':
      return create(Pb.InstructionSchema, {
        do: { case: 'move', value: { to: one.to, ease: EASE[one.ease] } },
      });
    case 'pick':
    case 'place':
      return create(Pb.InstructionSchema, {
        do: { case: one.do, value: { caseId: one.case } },
      });
    case 'wait':
      return create(Pb.InstructionSchema, {
        do: { case: 'wait', value: { seconds: one.seconds } },
      });
    case 'gate':
      return create(Pb.InstructionSchema, {
        do: { case: 'gate', value: { id: one.id } },
      });
  }
};

const plan = (one: Plan): Pb.Plan =>
  create(Pb.PlanSchema, {
    arm: one.arm,
    revision: one.revision,
    holding: one.holding ?? undefined,
    known: one.known,
    instructions: one.instructions.map(instruction),
  });

const command = (one: Command): Pb.Command => {
  switch (one.type) {
    case 'load':
      return create(Pb.CommandSchema, {
        arm: one.arm,
        type: { case: 'load', value: plan(one.plan) },
      });
    case 'open':
      return create(Pb.CommandSchema, {
        arm: one.arm,
        type: { case: 'open', value: { gate: one.gate } },
      });
    default:
      return create(Pb.CommandSchema, {
        arm: one.arm,
        type: { case: one.type, value: {} },
      });
  }
};

const encodeToArm = (message: ToArm) =>
  toBinary(
    Pb.ToArmSchema,
    create(Pb.ToArmSchema, {
      body:
        message.type === 'scene'
          ? {
              case: 'scene',
              value: { arm: message.arm, boxes: message.boxes },
            }
          : { case: 'command', value: command(message) },
    })
  );

// Plain objects out, not messages: the hub compares and spreads them.
const point = ({ x, y, z }: Pb.Point) => ({ x, y, z });

const joints = ({ yaw, shoulder, elbow, wrist, roll, grip }: Pb.Joints) => ({
  yaw,
  shoulder,
  elbow,
  wrist,
  roll,
  grip,
});

const pose = ({ at, facing }: Pb.Pose) => ({
  at: point(at ?? create(Pb.PointSchema)),
  facing,
});

const readInstruction = ({ do: one }: Pb.Instruction): Instruction => {
  switch (one.case) {
    case 'move':
      return {
        do: 'move',
        to: pose(one.value.to ?? create(Pb.PoseSchema)),
        ease: named(EASE, one.value.ease, 'ease'),
      };
    case 'pick':
    case 'place':
      return { do: one.case, case: one.value.caseId };
    case 'wait':
      return { do: 'wait', seconds: one.value.seconds };
    case 'gate':
      return { do: 'gate', id: one.value.id };
    default:
      throw new Error('An instruction on the wire does nothing');
  }
};

const readPlan = (one: Pb.Plan): Plan => ({
  arm: one.arm,
  revision: one.revision,
  holding: one.holding ?? null,
  known: one.known,
  instructions: one.instructions.map(readInstruction),
});

const readCommand = ({ arm, type }: Pb.Command): Command => {
  switch (type.case) {
    case 'load':
      return { type: 'load', arm, plan: readPlan(type.value) };
    case 'open':
      return { type: 'open', arm, gate: type.value.gate };
    case 'hold':
    case 'resume':
    case 'stop':
    case 'reset':
      return { type: type.case, arm };
    default:
      throw new Error('A command on the wire asks nothing');
  }
};

const decodeToArm = (bytes: Uint8Array): ToArm => {
  const { body } = fromBinary(Pb.ToArmSchema, bytes);

  switch (body.case) {
    case 'command':
      return readCommand(body.value);
    case 'scene':
      return {
        type: 'scene',
        arm: body.value.arm,
        boxes: body.value.boxes.map(({ id, min, max }) => ({
          id,
          min: point(min ?? create(Pb.PointSchema)),
          max: point(max ?? create(Pb.PointSchema)),
        })),
      };
    default:
      throw new Error('A message to an arm carries nothing');
  }
};

const telemetry = (one: Telemetry): Pb.Telemetry =>
  create(Pb.TelemetrySchema, {
    at: one.at,
    state: STATE[one.state],
    revision: one.revision ?? undefined,
    step: one.step,
    joints: one.joints,
    pad: one.pad,
    holding: one.holding ?? undefined,
  });

const encodeReport = (report: Report) => {
  const type = ((): Pb.Report['type'] => {
    switch (report.type) {
      case 'telemetry':
        return { case: 'telemetry', value: telemetry(report) };
      case 'loaded':
        return {
          case: 'loaded',
          value: create(Pb.Report_LoadedSchema, { revision: report.revision }),
        };
      case 'done':
        return {
          case: 'done',
          value: create(Pb.Report_DoneSchema, { revision: report.revision }),
        };
      case 'rejected':
        return {
          case: 'rejected',
          value: create(Pb.Report_RejectedSchema, {
            revision: report.revision,
            reason: report.reason,
          }),
        };
      case 'progress':
        return {
          case: 'progress',
          value: create(Pb.Report_ProgressSchema, {
            revision: report.revision,
            step: report.step,
          }),
        };
      case 'held':
        return {
          case: 'held',
          value: create(Pb.Report_HeldSchema, {
            cause: CAUSE[report.cause],
            seen: report.seen,
          }),
        };
      case 'resumed':
        return { case: 'resumed', value: create(Pb.Report_ResumedSchema) };
      case 'stopped':
        return { case: 'stopped', value: create(Pb.Report_StoppedSchema) };
      case 'reset':
        return { case: 'reset', value: create(Pb.Report_ResetSchema) };
    }
  })();

  return toBinary(
    Pb.ReportSchema,
    create(Pb.ReportSchema, { arm: report.arm, type })
  );
};

const decodeReport = (bytes: Uint8Array): Report => {
  const { arm, type } = fromBinary(Pb.ReportSchema, bytes);

  switch (type.case) {
    case 'telemetry': {
      const { value } = type;
      const { at, state, revision, step, pad, holding } = value;

      return {
        type: 'telemetry',
        arm,
        at,
        state: named(STATE, state, 'state'),
        revision: revision ?? null,
        step,
        joints: joints(value.joints ?? create(Pb.JointsSchema)),
        pad: pose(pad ?? create(Pb.PoseSchema)),
        holding: holding ?? null,
      };
    }
    case 'loaded':
    case 'done':
      return { type: type.case, arm, revision: type.value.revision };
    case 'rejected':
      return {
        type: 'rejected',
        arm,
        revision: type.value.revision,
        reason: type.value.reason,
      };
    case 'progress':
      return {
        type: 'progress',
        arm,
        revision: type.value.revision,
        step: type.value.step,
      };
    case 'held':
      return {
        type: 'held',
        arm,
        cause: named(CAUSE, type.value.cause, 'cause'),
        seen: type.value.seen,
      };
    case 'resumed':
    case 'stopped':
    case 'reset':
      return { type: type.case, arm };
    default:
      throw new Error('A report on the wire says nothing');
  }
};

export { decodeReport, decodeToArm, encodeReport, encodeToArm };
export type { Scene, ToArm };
