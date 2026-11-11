"""The twin's socket: the same `/arm/link` the bridge serves, so the bridge relays to it unchanged.

The socket runs in its own thread; messages wait in a queue until the
simulation loop takes them, and answers go back on the socket they came from.
When a socket closes, None goes in the queue in its place, so the twin lets
go of what that page had attached.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable

from websockets.sync.server import ServerConnection, serve

from kicl.robot.v1 import robot_pb2 as wire

Reply = Callable[[bytes], None]


class Link:
    def __init__(self, host: str, port: int) -> None:
        self.inbox: queue.Queue[tuple[wire.ToBridge | None, Reply]] = queue.Queue()
        self.server = serve(self._session, host, port)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def _session(self, socket: ServerConnection) -> None:
        if socket.request is None or socket.request.path != "/arm/link":
            socket.close(1008, "not here")
            return

        def reply(data: bytes) -> None:
            try:
                socket.send(data)
            except Exception:  # A page that went away mid-answer has nothing to hear.
                pass

        print("link: a bridge dialled in", flush=True)
        try:
            for data in socket:
                if isinstance(data, bytes):
                    try:
                        self.inbox.put((wire.ToBridge.FromString(data), reply))
                    except Exception as error:
                        print(f"link: dropped a frame that does not decode ({error})", flush=True)
        except Exception:  # A page that goes away without closing is still gone.
            pass
        self.inbox.put((None, reply))
        print("link: a bridge hung up", flush=True)

    def pending(self) -> list[tuple[wire.ToBridge | None, Reply]]:
        taken = []
        while True:
            try:
                taken.append(self.inbox.get_nowait())
            except queue.Empty:
                return taken

    def close(self) -> None:
        self.server.shutdown()
