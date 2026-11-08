.PHONY: app app-dev dev-name package dist serve dev css test bump
.DEFAULT_GOAL := app

node_modules: package.json
	npm install
	@touch node_modules

# Desktop app (Electron Forge). The npm scripts build the CSS first.
app: node_modules
	npm start

# Desktop app with live reload: styles.scss recompiles on save, and main.js reloads the window on any src/ change.
# The stock dev Electron.app names the macOS menu bar "Electron" (its own Info.plist), so rename it
# to productName. Lives in node_modules: a reinstall resets it and the next app-dev re-applies it.
DEV_PLIST := node_modules/electron/dist/Electron.app/Contents/Info.plist
dev-name: node_modules
	@name=$$(node -p "require('./package.json').productName"); \
	for k in CFBundleName CFBundleDisplayName; do plutil -replace $$k -string "$$name" $(DEV_PLIST); done

app-dev: css dev-name
	@trap 'kill 0' INT TERM EXIT; \
	npm run watch:css & \
	npx electron-forge start

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

# Bump package.json + package-lock.json version (no commit, no tag). PART=patch|minor|major, default patch.
PART ?= patch
bump:
	@npm version $(PART) --no-git-tag-version
