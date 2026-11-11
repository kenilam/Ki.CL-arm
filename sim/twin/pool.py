"""The twin's rigs, leased to pages: each page's arm gets a rig of its own.

A page socket is a session. The first arm a session attaches leases a free
rig, and the rig drives that arm alone until the session detaches it or hangs
up, when the rig is reset to an empty cell and its arm at home: a new arm for
the next page. Two pages never touch each other's rig. An arm attached while
every rig is leased gets hold-still answers, as the bridge gives without a twin.
"""

from __future__ import annotations

from collections.abc import Hashable

from kicl.robot.v1 import robot_pb2 as wire
from twin import Twin, hold


class Pool:
    def __init__(self, twins: list[Twin]) -> None:
        self.twins = twins
        # (session, arm id) to the twin driving it.
        self.leases: dict[tuple[Hashable, str], Twin] = {}

    def _free(self) -> Twin | None:
        busy = set(map(id, self.leases.values()))
        return next((twin for twin in self.twins if id(twin) not in busy), None)

    def _release(self, key: tuple[Hashable, str]) -> None:
        twin = self.leases.pop(key)
        twin.receive(None)

    def receive(self, session: Hashable, message: wire.ToBridge | None) -> wire.FromBridge | None:
        """One message from a session's socket; None means the session hung up."""
        if message is None:
            for key in [key for key in self.leases if key[0] == session]:
                self._release(key)
            print(f"pool: a page hung up; {len(self.twins) - len(self.leases)} of {len(self.twins)} rigs free", flush=True)
            return None
        kind = message.WhichOneof("message")
        if kind == "attach":
            if message.attach.robot != wire.Attach.ROBOT_ARM:
                return None
            key = (session, message.attach.id)
            twin = self.leases.get(key) or self._free()
            if twin is None:
                print(f"pool: every rig is leased; {message.attach.id} holds still", flush=True)
                return None
            self.leases[key] = twin
            twin.receive(message)
            return None
        if kind == "detach":
            key = (session, message.detach.id)
            if key in self.leases:
                self._release(key)
            return None
        if kind != "sensors":
            return None
        commands = []
        for frame in message.sensors.frames:
            twin = self.leases.get((session, frame.id))
            if twin is None:
                commands.append(hold(frame))
                continue
            answer = twin.receive(wire.ToBridge(sensors=wire.SensorBatch(frames=[frame])))
            commands.extend(answer.commands if answer else [hold(frame)])
        return wire.FromBridge(commands=commands)

    def step(self, dt: float) -> None:
        for twin in self.twins:
            twin.step(dt)
