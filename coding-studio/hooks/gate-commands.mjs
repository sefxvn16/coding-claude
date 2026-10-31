// PreToolUse (Bash|PowerShell): ask before commands matching gated_commands.
// Safety net, not a guarantee: commands are normalized (wrappers, paths, extensions,
// shell -c strings) before matching, but a determined bypass can still exist.
import { DEFAULT_GATED, globToRegex, preToolUse, runHook } from '../scripts/lib/config.mjs';
import { MAX_LENGTH, collapse, normalizedSegments, skipPackageOptions } from '../scripts/lib/shell.mjs';

const ask = (reason) => preToolUse({ permissionDecision: 'ask', permissionDecisionReason: `coding-studio: ${reason}` });
const PM = /^(npm|pnpm|yarn|bun)$/i;

/** Package-manager publish, including unambiguous npm-style abbreviations (pub, publ, publi). */
function isPublish(tokens) {
  if (!PM.test(tokens[0] ?? '')) return false;
  if (tokens.slice(1).some((t) => t.toLowerCase() === 'publish')) return true;
  let rest = skipPackageOptions(tokens.slice(1));
  if (tokens[0].toLowerCase() === 'yarn' && rest[0]?.toLowerCase() === 'npm') rest = skipPackageOptions(rest.slice(1));
  const sub = rest[0]?.toLowerCase();
  return !!sub && sub.length >= 3 && 'publish'.startsWith(sub);
}

runHook('gate-commands', (input, { config, broken }) => {
  const command = input.tool_input?.command;
  const patterns = broken ? DEFAULT_GATED : config.gated_commands;
  if (typeof command !== 'string' || !Array.isArray(patterns)) return null;
  const ps = input.tool_name === 'PowerShell';
  if (command.length > MAX_LENGTH) return ask(`command too complex to check (over ${MAX_LENGTH} characters)`);
  const { segments, tokenSegments, unbalanced, opaque } = normalizedSegments(command, 0, ps);
  if (opaque) return ask('shell reads commands from stdin that cannot be extracted and checked');
  const raw = collapse(ps ? command.replace(/`/g, '') : command);
  const cands = [raw, ...segments];
  const publish = tokenSegments.some(isPublish);
  for (const pattern of [...patterns, ...(publish ? ['package-manager publish'] : [])]) {
    const p = String(pattern).trim();
    if (!p) continue;
    const re = globToRegex(p, false);
    const significant = p.toLowerCase().split(/[\s*?]+/).filter(Boolean);
    const ordered = tokenSegments.some((tokens) => {
      if (!significant.length || tokens[0]?.toLowerCase() !== significant[0]) return false;
      let next = 1;
      for (const token of tokens.slice(1)) {
        if (token.toLowerCase() === significant[next]) next++;
      }
      return next === significant.length;
    });
    const hit = (publish && p === 'package-manager publish') || ordered || cands.some((c) => re.test(c)) || (unbalanced && globToRegex(`*${p}`, false).test(raw));
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
}, (input) => ask('command too complex to check'));
