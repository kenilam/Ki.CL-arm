"""The twin's brain for one arm: mirror the cell, plan, and move.

It speaks the same frames as the classic brain. Each sensor frame updates
the mirror of the cell; each simulation step works through the plan, with
RMPflow (in the body) doing the moving. The answer to every frame is where
the twin's arm is now and whether its pad holds a case, which the floor's
drives then follow. Robots the twin is not driving get a hold-still answer.
"""

from __future__ import annotations

from typing import Protocol

from arm import Target
from placement import under
from planner import Step, plan
from kicl.robot.v1 import robot_pb2 as wire

# Seconds a move may take before the plan is dropped and made again.
MOVE_PATIENCE = 8.0
# Seconds to wait for the pad to seal or let go.
GRIP_PATIENCE = 1.5
# Seconds between looks for a new job while idle.
IDLE = 0.5
# Seconds between lines in the log about what the twin is doing.
REPORT = 1.0


class Body(Protocol):
    """The arm and cell in the simulator."""

    def take_over(self, arm: wire.ArmSensors, handover: wire.Handover | None) -> None: ...
    def mirror(self, vision) -> None: ...
    def reset(self) -> None: ...
    def joints(self) -> dict[str, float]: ...
    def pad(self) -> Target: ...
    def holding(self): ...
    def track(self, target: Target) -> None: ...
    def hold(self) -> None: ...
    def arrived(self, target: Target) -> bool: ...
    def grip(self) -> bool: ...
    def release(self) -> None: ...


def hold(frame: wire.Sensors) -> wire.Commands:
    if frame.WhichOneof("robot") == "arm":
        return wire.Commands(id=frame.id, tick=frame.tick, arm=wire.ArmCommands(target=frame.arm.position, vacuum=frame.arm.gripper.vacuum))
    return wire.Commands(id=frame.id, tick=frame.tick, amr=wire.AmrCommands(lift=frame.amr.lifted))


class Twin:
    def __init__(self, body: Body) -> None:
        self.body = body
        self.arm: str | None = None
        self.frame: wire.ArmSensors | None = None
        self.fresh = False
        self.handover: wire.Handover | None = None
        self.steps: list[Step] = []
        self.elapsed = 0.0
        self.rest = 0.0
        self.since = 0.0

    def _let_go(self) -> None:
        self.arm, self.frame, self.steps, self.handover = None, None, [], None
        self.body.reset()

    def receive(self, message: wire.ToBridge | None) -> wire.FromBridge | None:
        """Takes one message from a page; None means that page hung up."""
        if message is None:
            # A page that went away takes its arm and its cell with it; the next page starts afresh.
            if self.arm is not None:
                self._let_go()
            return None
        kind = message.WhichOneof("message")
        if kind == "attach":
            if message.attach.robot == wire.Attach.ROBOT_ARM and self.arm in (None, message.attach.id):
                if self.arm is not None:
                    self._let_go()
                self.arm, self.fresh = message.attach.id, True
                self.handover = message.attach.handover if message.attach.HasField("handover") else None
            return None
        if kind == "detach":
            if message.detach.id == self.arm:
                self._let_go()
            return None
        if kind != "sensors":
            return None
        commands = []
        for frame in message.sensors.frames:
            if frame.id == self.arm and frame.WhichOneof("robot") == "arm":
                self._sense(frame.arm)
                joints = self.body.joints()
                commands.append(wire.Commands(id=frame.id, tick=frame.tick, arm=wire.ArmCommands(target=wire.Joints(**joints), vacuum=self.body.holding() is not None)))
            else:
                commands.append(hold(frame))
        return wire.FromBridge(commands=commands)

    def _sense(self, arm: wire.ArmSensors) -> None:
        if self.fresh:
            # Taking over: start from the handover's joints and grip, or the arm's own when there is none.
            self.body.take_over(arm, self.handover)
            self.fresh = False
        self.frame = arm
        self.body.mirror(arm.vision)

    def step(self, dt: float) -> None:
        """Advances the plan by one simulation step."""
        if self.arm is None or self.frame is None:
            return
        if self.frame.intrusion:
            self.body.hold()
            return
        self.rest -= dt
        if not self.steps and self.rest <= 0:
            self.steps = plan(self.frame.vision, self.body.pad(), self.body.holding()) or []
            self.elapsed, self.rest = 0.0, IDLE
        if not self.steps:
            self.body.hold()
            return
        head = self.steps[0]
        self.elapsed += dt
        self.since += dt
        if self.since >= REPORT:
            self.since = 0.0
            pad = self.body.pad()
            joints = " ".join(f"{name} {value:.2f}" for name, value in self.body.joints().items())
            print(f"twin: {head.kind} to {head.to} | pad {pad.x:.2f} {pad.y:.2f} {pad.z:.2f} yaw {pad.yaw:.2f} | {joints} | holding {self.body.holding() is not None}", flush=True)
        if head.kind == "move":
            self.body.track(head.to)
            done = self.body.arrived(head.to)
            failed = self.elapsed > MOVE_PATIENCE
        elif head.kind == "grip":
            done = self.body.grip()
            failed = self.elapsed > GRIP_PATIENCE
        else:
            pad = self.body.pad()
            if not any(item.kind == item.KIND_PALLET and under(item, pad.x, pad.z) for item in self.frame.vision):
                # The pallet has gone since the plan was made: carry the case somewhere else.
                self.steps = []
                return
            self.body.release()
            done, failed = True, False
        if done:
            self.steps.pop(0)
            self.elapsed = 0.0
        elif failed:
            self.steps = []
