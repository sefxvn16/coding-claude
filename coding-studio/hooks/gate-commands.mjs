// PreToolUse (Bash|PowerShell): ask before commands matching gated_commands.
// Safety net, not a guarantee: commands are normalized (wrappers, paths, extensions,
// shell -c strings) before matching, but a determined bypass can still exist.
import { DEFAULT_GATED, globToRegex, preToolUse, runHook } from '../scripts/lib/config.mjs';
import { collapse, normalizedSegments } from '../scripts/lib/shell.mjs';

runHook('gate-commands', (input, { config, broken }) => {
  const command = input.tool_input?.command;
  const patterns = broken ? DEFAULT_GATED : config.gated_commands;
  if (typeof command !== 'string' || !Array.isArray(patterns)) return null;
  const ps = input.tool_name === 'PowerShell';
  const { segments, unbalanced } = normalizedSegments(command, 0, ps);
  const raw = collapse(ps ? command.replace(/`/g, '') : command);
  const cands = [raw, ...segments];
  for (const pattern of patterns) {
    const p = String(pattern).trim();
    if (!p) continue;
    const re = globToRegex(p, false);
    const hit = cands.some((c) => re.test(c)) || (unbalanced && globToRegex(`*${p}`, false).test(raw));
    if (hit) {
      const shown = command.length > 200 ? command.slice(0, 200) + '...' : command;
      const why = broken
        ? 'config broken (.studio/project.json unparseable; built-in gated list applied)'
        : `command matches gated pattern "${p}"`;
      return preToolUse({
        permissionDecision: 'ask',
        permissionDecisionReason: `coding-studio: ${why}: ${shown}`,
      });
    }
  }
  return null;
});
