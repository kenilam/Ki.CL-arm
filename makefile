install:
	@echo ⌛ installing...
	yarn
	@echo done

# The bridge's port: from BRIDGE_LISTEN, else 3200. Whatever already holds it is stopped first.
BRIDGE_PORT := $(or $(lastword $(subst :, ,$(BRIDGE_LISTEN))),3200)

# The twin the bridge relays Physical AI to: by default, the GCP machine through `make gcp.tunnel`.
# With no tunnel up, robots switched to Physical AI hold still. `BRIDGE_UPSTREAM= make run` turns it off.
BRIDGE_UPSTREAM ?= ws://localhost:3300/arm/link
export BRIDGE_UPSTREAM

# The remote, rebuilt as it changes, and the bridge serving it on 127.0.0.1:3200.
run:
	@scripts/free-port.sh $(BRIDGE_PORT)
	@echo ⌛ running development...
	yarn run development

build:
	@echo ⌛ building the remote...
	yarn run build
	@echo done

# The remote's tests, then the bridge's.
test:
	@echo ⌛ running tests...
	yarn run test

typecheck:
	@echo ⌛ type checking...
	yarn run typecheck
	@echo done

# TypeScript for the wire, from proto/, into the remote.
codegen:
	@echo ⌛ generating...
	yarn run codegen
	@echo done

# The twin's brain and socket, without Isaac, in a local venv (sim/.venv).
test.twin:
	@echo ⌛ testing the twin...
	test -d sim/.venv || python3 -m venv sim/.venv
	sim/.venv/bin/pip install --quiet -r sim/twin/requirements.txt
	cd sim/twin && ../.venv/bin/python -m unittest test_twin

# The arm for Isaac Sim and cuMotion, from client/src/robot/spec.ts, into sim/robot.
assets:
	@echo ⌛ writing the arm for the twin...
	yarn run assets
	@echo done

lint:
	@echo ⌛ linting the schema...
	yarn run lint
	@echo done

# Fails on a change to the schema that an arm built against main could not read.
breaking:
	yarn run breaking

# The GCP machine for Isaac. Values in gcp/env.sh; override from the environment.
gcp.quota:
	gcp/quota.sh

gcp.up:
	gcp/up.sh

gcp.down:
	gcp/down.sh

gcp.delete:
	gcp/down.sh --delete

gcp.status:
	gcp/status.sh

gcp.ssh:
	gcp/ssh.sh

# localhost:3300 onto the machine.
gcp.tunnel:
	gcp/tunnel.sh

gcp.ngc:
	gcp/ngc.sh

# A command in Isaac Sim's container on the machine, detached; no command runs the stock Franka example headless.
gcp.isaac:
	gcp/isaac.sh $(CMD)

# The twin: sim/ onto the machine, run in Isaac Sim's container on PORT (3200, or 3201 with STAGE=dev).
gcp.twin:
	gcp/twin.sh

gcp.isaac.log:
	gcp/ssh.sh tail -n 40 /var/lib/arm/isaac/run.log
