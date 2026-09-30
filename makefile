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
