# Modular design: core + replaceable modules

Read when designing a new project, a new feature area, or a split of code that grew too big. The goal: each module can be built by one agent alone, switched off for repair, or replaced, while the rest keeps working. `.studio/modules.json` records and enforces the result; it does not create it.

## 1. Shape

- **Core** is small and stable: shared state, the main loop or request flow, and the **ports** other modules plug into (an interface, a base class, an event/signal list, or a registry of handlers). Core imports no optional module.
- **Modules** each own one area (a game rule set, a screen, a payment provider, a data source). A module talks to others only through core's ports or another module's `public` files, never its internals.
- **Data and numbers** (balance values, texts, maps, config) live in data files, not in code, so a module can change behavior without touching another module's code.
- Registry mapping: core = a module with `optional: false` and a short `public` list (the port files); a feature that can be switched off = `optional: true` with `depends_on: ["core"]`. A required module may not depend on an optional one (config error), and the dependency check catches core importing a feature it does not list.

## 2. Switch off for repair

- Each optional module registers itself with core at start-up (a registry entry, a plugin list, a signal connection). Core calls it only through the port; when nothing is registered, core uses a no-op or simple fallback.
- The on/off switch sits in config or data (a list of enabled features), not in code edits, so switching off needs no change to core.
- `off_test`: a test that runs the main flow with the module switched off and passes. It must be part of the project's test command; `check-modules.mjs` warns when the file is missing.
- To repair: switch the module off in config (the product still runs on the fallback), unlock only that module in the registry, fix it, run its tests and the off_test, switch it back on, lock it again.

## 3. Replace

- The port is the contract. Contract tests for the port (inputs, outputs, events, error cases) live with core and run against every implementation.
- A replacement is a new module implementing the same port. Register it instead of the old one; both pass the same contract tests. Keep the old one locked until the new one is accepted, then remove it in its own task.
- Changing a port (new field, new event, changed meaning) is a public-interface change: M2, and every module on both sides is in scope.

## 4. Independent work by several agents

- One module per builder; scopes are disjoint. Two tasks that both need to change a port are done one after the other, not in parallel.
- A builder that needs another module changed reports it; Lead opens a separate task (SKILL section 4b).

## 5. Stack hints (follow the project's existing conventions first)

- Godot: core rules as plain `RefCounted` scripts without nodes; ports as base scripts or signal lists; modules registered in one registry script; scenes and UI in their own modules reading state through core's public API.
- Web/frontend: one folder per feature with an `index.ts` as its only public file; shared UI kit and API client as their own modules; a boundary linter in `commands.lint` for aliases the registry check cannot see.
- App/backend: one package or folder per domain; interfaces in core for storage, payment, messaging; adapters as modules.

## 6. When and how to split code that grew too big

Signals (heuristics, judge per project): `check-modules.mjs` shows one file far larger than the rest (roughly 800+ lines), a file changed by a large share of recent commits (roughly 40%+), or most tasks need the same file. Then propose a split to the owner; never start one inside an unrelated task.

1. Audit: `check-modules.mjs` (largest, most changed, dependency map). Draft or update the registry with every module `open`.
2. Pin current behavior: characterization tests for the area to split, passing on the current code, before any move.
3. Plan (architect): target modules and ports, the order of moves, one move per task.
4. Move one area at a time behind its port: no behavior change, all tests green after each move, scope = the area being moved plus the port.
5. Mark modules `optional` only once they really run switched off (off_test passing). Lock each module when it is stable.
