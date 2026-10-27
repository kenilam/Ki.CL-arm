"""The twin: Isaac Sim with one palletizing arm, answering the floor on /arm/link.

Run inside Isaac Sim's container, headless, with the twin and its wire on
the path: `make gcp.twin` does that on the GCP machine.
"""

from __future__ import annotations

import argparse
import sys
import traceback

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="0.0.0.0")
parser.add_argument("--port", type=int, default=3200)
# Rigs in the stage: how many pages can each have an arm on the twin at once.
parser.add_argument("--rigs", type=int, default=4)
# CPU physics: the cell gains and loses cases while it runs, which PhysX's GPU tensor views do not allow.
parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
args, _ = parser.parse_known_args()

from isaacsim import SimulationApp  # noqa: E402

app = SimulationApp({"headless": True})

import omni.kit.app  # noqa: E402

manager = omni.kit.app.get_app().get_extension_manager()
for extension in ("omni.scene.optimizer.core", "isaacsim.robot.schema"):
    manager.set_extension_enabled_immediate(extension, True)

import isaacsim.core.experimental.utils.app as app_utils  # noqa: E402
from isaacsim.core.simulation_manager import SimulationManager  # noqa: E402

from link import Link  # noqa: E402
from pool import Pool  # noqa: E402
from scene import Rig, stage  # noqa: E402
from twin import Twin  # noqa: E402

DT = 1.0 / 60.0


def main() -> None:
    SimulationManager.setup_simulation(dt=DT, device=args.device)
    stage()
    rigs = [Rig(index, DT) for index in range(args.rigs)]
    app.update()
    app_utils.play()
    app.update()
    for rig in rigs:
        rig.start()
    pool = Pool([Twin(rig) for rig in rigs])
    link = Link(args.host, args.port)
    print(f"twin on ws://{args.host}:{args.port}/arm/link with {len(rigs)} rigs", flush=True)
    try:
        while app.is_running():
            # Each socket's reply is its own, so it stands for the page's session.
            for message, reply in link.pending():
                answer = pool.receive(reply, message)
                if answer is not None:
                    reply(answer.SerializeToString())
            pool.step(DT)
            for rig in rigs:
                rig.step()
            app.update()
    finally:
        link.close()


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        # The app's fast shutdown ends the process before Python would print this.
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
    finally:
        app.close()
