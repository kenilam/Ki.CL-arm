install:
	@echo ⌛ installing...
	yarn
	@echo done

# Rebuilds the remote as it changes and serves it with the simulated arms on :3200.
run:
	@echo ⌛ running development...
	yarn run development

build:
	@echo ⌛ building the remote...
	yarn run build
	@echo done

# The remote as last built, and the simulated arms, without watching.
serve:
	@echo ⌛ serving...
	yarn run serve

test:
	@echo ⌛ running tests...
	yarn run test

typecheck:
	@echo ⌛ type checking...
	yarn run typecheck
	@echo done

# TypeScript for the wire, from proto/.
codegen:
	@echo ⌛ generating...
	yarn run codegen
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

# localhost:3200 becomes the machine's 3200, so Ki.CL's /arm proxy reaches it unchanged.
gcp.tunnel:
	gcp/tunnel.sh

gcp.ngc:
	gcp/ngc.sh

# A command in Isaac Sim's container on the machine, detached; no command runs the stock Franka example headless.
gcp.isaac:
	gcp/isaac.sh $(CMD)

gcp.isaac.log:
	gcp/ssh.sh tail -n 40 /var/lib/arm/isaac/run.log
