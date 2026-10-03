"""The twin's brain and socket, without Isaac: a fake body moves the pad straight to each target."""

from __future__ import annotations

import math
import sys
import time
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).parent), str(Path(__file__).parent / "wire")]

from websockets.sync.client import connect  # noqa: E402

from arm import Target, forward  # noqa: E402
from kicl.robot.v1 import robot_pb2 as wire  # noqa: E402
from link import Link  # noqa: E402
from twin import Twin  # noqa: E402

HOME = {"base": 0.0, "shoulder": 0.3, "elbow": 0.6, "wrist": -0.9, "flange": 0.0}


class FakeBody:
    """Moves the pad at a fixed speed, seals on a case top it touches, and drops a case where it lets go."""

    def __init__(self) -> None:
        self.at = forward(HOME)
        self.target = self.at
        self.cases: dict[str, wire.Seen] = {}
        self.held: wire.Seen | None = None
        self.placed: list[Target] = []

    def take_over(self, arm, handover=None) -> None:
        source = handover if handover is not None else arm
        self.at = forward({name: getattr(source.position, name) for name in HOME})
        if handover is not None and handover.vacuum and handover.held:
            self.held = next((item for item in arm.vision if item.id == handover.held), None)

    def mirror(self, vision) -> None:
        self.cases = {item.id: item for item in vision if item.kind == item.KIND_CASE}

    def reset(self) -> None:
        self.held = None
        self.at = forward(HOME)
        self.cleared = getattr(self, "cleared", 0) + 1

    def joints(self) -> dict[str, float]:
        return dict(HOME)

    def pad(self) -> Target:
        return self.at

    def holding(self):
        return self.held

    def track(self, target: Target) -> None:
        self.target = target
        dx, dy, dz = target.x - self.at.x, target.y - self.at.y, target.z - self.at.z
        distance = math.sqrt(dx * dx + dy * dy + dz * dz)
        step = min(1.0, 0.05 / distance) if distance else 1.0
        self.at = Target(self.at.x + dx * step, self.at.y + dy * step, self.at.z + dz * step, target.yaw)

    def hold(self) -> None:
        pass

    def arrived(self, target: Target) -> bool:
        return math.dist((self.at.x, self.at.y, self.at.z), (target.x, target.y, target.z)) < 0.015

    def grip(self) -> bool:
        for case in self.cases.values():
            if math.dist((case.top.x, case.top.y, case.top.z), (self.at.x, self.at.y, self.at.z)) < 0.03:
                self.held = case
        return self.held is not None

    def release(self) -> None:
        if self.held is not None:
            self.placed.append(self.at)
        self.held = None


def frame(tick: int, waiting: bool = True) -> wire.ToBridge:
    position = wire.Joints(**HOME)
    vision = [wire.Seen(id="pallet", kind=wire.Seen.KIND_PALLET, top=wire.Vector(x=0.0, y=0.15, z=1.7), width=1.2, depth=1.0, height=0.15)]
    if waiting:
        vision.append(wire.Seen(id="case-1", kind=wire.Seen.KIND_CASE, top=wire.Vector(x=1.7, y=1.05, z=0.0), width=0.4, depth=0.3, height=0.3, waiting=True))
    arm = wire.ArmSensors(position=position, velocity=wire.Joints(), gripper=wire.Gripper(), vision=vision)
    return wire.ToBridge(sensors=wire.SensorBatch(frames=[wire.Sensors(id="arm-0", tick=tick, time=tick / 50, arm=arm)]))


def attach(id: str = "arm-0") -> wire.ToBridge:
    return wire.ToBridge(attach=wire.Attach(id=id, robot=wire.Attach.ROBOT_ARM))


class TwinTest(unittest.TestCase):
    def test_picks_the_waiting_case_and_sets_it_on_the_pallet(self) -> None:
        body = FakeBody()
        twin = Twin(body)
        twin.receive(attach())
        for tick in range(2000):
            twin.receive(frame(tick, waiting=not body.placed and body.held is None))
            twin.step(1 / 60)
            if body.placed:
                break
        self.assertEqual(len(body.placed), 1)
        drop = body.placed[0]
        self.assertLess(abs(drop.x - 0.0), 0.6)
        self.assertLess(abs(drop.z - 1.7), 0.5)
        self.assertAlmostEqual(drop.y, 0.15 + 0.3, places=2)

    def test_answers_its_arm_and_holds_the_rest(self) -> None:
        twin = Twin(FakeBody())
        twin.receive(attach())
        twin.receive(attach("arm-1"))
        batch = frame(3)
        other = wire.Sensors()
        other.CopyFrom(batch.sensors.frames[0])
        other.id = "arm-1"
        other.arm.position.base = 0.7
        other.arm.gripper.vacuum = True
        batch.sensors.frames.append(other)
        reply = twin.receive(batch)
        self.assertEqual([command.id for command in reply.commands], ["arm-0", "arm-1"])
        self.assertAlmostEqual(reply.commands[1].arm.target.base, 0.7, places=5)
        self.assertTrue(reply.commands[1].arm.vacuum)

    def test_holds_still_while_someone_is_in_the_cell(self) -> None:
        body = FakeBody()
        twin = Twin(body)
        twin.receive(attach())
        batch = frame(1)
        batch.sensors.frames[0].arm.intrusion = True
        twin.receive(batch)
        start = body.pad()
        for _ in range(100):
            twin.step(1 / 60)
        self.assertEqual(body.pad(), start)


class HandoverTest(unittest.TestCase):
    def test_carries_on_holding_the_case_it_was_handed(self) -> None:
        body = FakeBody()
        twin = Twin(body)
        message = attach()
        message.attach.handover.CopyFrom(wire.Handover(position=wire.Joints(**HOME), vacuum=True, held="case-1"))
        twin.receive(message)
        reply = twin.receive(frame(1))
        self.assertIsNotNone(body.holding())
        self.assertTrue(reply.commands[0].arm.vacuum)
        for _ in range(3000):
            twin.receive(frame(2, waiting=False))
            twin.step(1 / 60)
            if body.placed:
                break
        self.assertEqual(len(body.placed), 1)


class ReconnectTest(unittest.TestCase):
    def test_starts_afresh_when_the_page_hangs_up(self) -> None:
        body = FakeBody()
        twin = Twin(body)
        twin.receive(attach())
        twin.receive(frame(1))
        twin.receive(None)
        self.assertIsNone(twin.arm)
        self.assertEqual(body.cleared, 1)
        twin.receive(attach())
        self.assertEqual(twin.arm, "arm-0")

    def test_takes_a_second_attach_for_its_arm_as_a_new_start(self) -> None:
        body = FakeBody()
        twin = Twin(body)
        twin.receive(attach())
        twin.receive(frame(1))
        twin.receive(attach())
        self.assertTrue(twin.fresh)
        self.assertEqual(body.cleared, 1)


class PoolTest(unittest.TestCase):
    def test_gives_each_page_its_own_rig_and_frees_it_when_the_page_goes(self) -> None:
        from pool import Pool

        bodies = [FakeBody(), FakeBody()]
        pool = Pool([Twin(body) for body in bodies])
        pool.receive("page-a", attach())
        pool.receive("page-b", attach())
        self.assertEqual(len({id(twin) for twin in pool.leases.values()}), 2)

        # A third page finds every rig leased: its arm holds still.
        pool.receive("page-c", attach())
        reply = pool.receive("page-c", frame(4))
        self.assertAlmostEqual(reply.commands[0].arm.target.shoulder, 0.3, places=5)
        self.assertNotIn(("page-c", "arm-0"), pool.leases)

        pool.receive("page-a", None)
        self.assertEqual(sum(getattr(body, "cleared", 0) for body in bodies), 1)
        pool.receive("page-c", attach())
        self.assertIn(("page-c", "arm-0"), pool.leases)

    def test_a_page_drives_only_its_own_rig(self) -> None:
        from pool import Pool

        bodies = [FakeBody(), FakeBody()]
        pool = Pool([Twin(body) for body in bodies])
        pool.receive("page-a", attach())
        pool.receive("page-b", attach())
        for tick in range(400):
            pool.receive("page-a", frame(tick))
            pool.step(1 / 60)
        moved = [body.at != forward(HOME) for body in bodies]
        self.assertEqual(moved, [True, False])


class SquareTest(unittest.TestCase):
    def test_keeps_the_flange_off_its_limits(self) -> None:
        from planner import _square
        from arm import wrap

        for x, z, yaw in [(-0.4, -1.66, -2.09), (1.7, 0.0, 3.0), (0.5, 1.5, 0.2)]:
            turned = _square(Target(x, 0.5, z, yaw))
            self.assertLessEqual(abs(wrap(turned.yaw - math.atan2(-z, x))), math.pi / 2 + 1e-9)
            self.assertAlmostEqual(math.cos(2 * turned.yaw), math.cos(2 * yaw), places=6)


class LinkTest(unittest.TestCase):
    def test_answers_over_a_real_socket(self) -> None:
        link = Link("127.0.0.1", 0)
        port = link.server.socket.getsockname()[1]
        twin = Twin(FakeBody())
        try:
            with connect(f"ws://127.0.0.1:{port}/arm/link") as socket:
                socket.send(attach().SerializeToString())
                socket.send(frame(9).SerializeToString())
                deadline = time.time() + 5
                reply = None
                while reply is None and time.time() < deadline:
                    for message, answer in link.pending():
                        out = twin.receive(message)
                        if out is not None:
                            answer(out.SerializeToString())
                            reply = wire.FromBridge.FromString(socket.recv(timeout=5))
                    time.sleep(0.01)
                self.assertIsNotNone(reply)
                self.assertEqual(reply.commands[0].tick, 9)
        finally:
            link.close()


if __name__ == "__main__":
    unittest.main()
