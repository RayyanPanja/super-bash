# Repository Guidelines

## Project Structure & Module Organization

Super Bash is an Electron desktop app. The main process starts in `main.js`, with renderer preload APIs in `preload.js`. UI files live in `renderer/` (`index.html`, `styles.css`, `terminal.js`). Shell/session helpers are in `shell/`, configuration loading is in `config/`, and image/tray assets are in `assets/`. Jest tests live in `tests/` and mirror module names such as `utils.test.js` and `configLoader.test.js`. Example configuration files are in `examples/`; design notes and feature plans are in `docs/`.

## Build, Test, and Development Commands

- `npm install`: install Electron, Jest, xterm, and native dependencies.
- `npm start`: run the Electron app locally from the repository root.
- `npm test`: run the Jest unit test suite in `tests/`.
- `npm run rebuild`: rebuild the native `node-pty` dependency after Electron or Node changes.
- `npm run build`: package the app with `electron-builder` using the `build` section in `package.json`.

## Coding Style & Naming Conventions

Use CommonJS modules (`require`, `module.exports`) and two-space indentation in JavaScript, matching the existing files. Prefer small, testable helpers in `shell/` or `config/` when logic does not require Electron or DOM APIs. Use camelCase for functions and variables, PascalCase only for constructor-style types/classes, and kebab-case for user-facing config filenames such as `team.config.json` examples. Keep comments useful and brief; avoid explaining obvious assignments.

## Testing Guidelines

Jest is the test framework. Add tests under `tests/` with the `*.test.js` suffix and group related cases with `describe()`. Prefer unit tests for pure helpers, especially config merging, path conversion, git status parsing, and failure fallback behavior. Run `npm test` before submitting changes. For Electron UI changes, include manual verification notes because the current suite does not launch the app.

## Commit & Pull Request Guidelines

Recent history uses short, informal subjects such as `Tier 3` and feature-plan notes; keep new commits concise but more descriptive when possible, for example `Add git status parser tests`. Pull requests should include a summary, test results (`npm test`, manual Electron checks), linked issues or docs when relevant, and screenshots or short recordings for renderer/UI changes.

## Configuration & Security Notes

Team defaults are read from `team.config.json`; personal overrides are read from `~/.superbash/personal.json`. Do not commit personal credentials, private shell paths, tokens, or generated local session data. When adding config keys, update defaults in `config/configLoader.js`, examples in `examples/`, and tests for merge behavior.
