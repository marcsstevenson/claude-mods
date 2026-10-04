# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins of function hooks that change what Claude Code does and draws, written in TypeScript against the engine's hooks API (early access, Claude Code 2.1.289+).

## Mods

| Mod | What it does |
| --- | --- |
| [better-recap](src/better-recap) | Replaces `/recap` with a structured recap (Goal / Done / Open / Next) drawn as a card headed by the session name, the model and a context-use bar. Prefixes the automatic "recap:" line shown after being away with the same facts. |

## Using a mod

Each folder under `src/` is a self-contained mod. Load one for a single session:

```
claude --plugin-dir path/to/claude-mods/src/better-recap
```

Or load it in every session by naming it in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json`. Separate several folders with the platform's path separator (`;` on Windows, `:` elsewhere):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "D:\\git\\claude-mods\\src\\better-recap"
  }
}
```

A folder loaded either way is watched: saving a file reloads the mod.

## Layout of a mod

```
src/<mod>/
  .claude-plugin/plugin.json   manifest: name, version, description, types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the hooks module: export const register: Register = on => { ... }
  hooks/*.test.ts              tests, run by `claude plugin test`
  types/index.d.ts             the mod's $.state contract, when it keeps state
  tsconfig.json                extends the types Claude Code lays in .claude-plugin/types/
```

`.claude-plugin/types/` is written by Claude Code each time it loads the mod and is not committed.

## Checking a mod

```
claude plugin validate src/<mod>   # what the engine would load or refuse
claude plugin test src/<mod>       # runs hooks/*.test.ts against the engine
npx tsc -p src/<mod>               # type-check, once the mod has loaded once
```
