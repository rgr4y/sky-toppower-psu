.PHONY: app package dist serve dev css test
.DEFAULT_GOAL := app

node_modules: package.json
	npm install
	@touch node_modules

# Desktop app (Electron Forge). The npm scripts build the CSS first.
app: node_modules
	npm start

package: node_modules
	npm run package

dist: node_modules
	npm run make

css: node_modules
	npm run build:css

serve: css
	npm run serve

# Dev: compile styles.scss once, then watch+recompile on change and serve src/ on :8150.
# Reload the browser after an edit (serve sends no-store, so a plain reload is enough). Ctrl-C stops both.
dev: css
	@trap 'kill 0' INT TERM EXIT; \
	npm run watch:css & \
	npm run serve & \
	wait

test:
	npm test
