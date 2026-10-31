import { DEFAULT_GATED, globToRegex, preToolUse, runHook } from '../scripts/lib/config.mjs';

const WRAPPERS = new Set(['env', 'command', 'call', 'start', 'exec', 'time', 'nohup', 'sudo', 'corepack',
  'npx', 'bunx', 'pnpx', 'bash', 'sh', 'zsh', 'cmd', 'pwsh', 'powershell']);
const PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const exeName = (w) => w.split(/[\\/]/).pop().toLowerCase().replace(/\.(?:cmd|exe|ps1|bat|com)$/, '');

function segments(command) {
  return command.split(/&&|\|\||\$\(|[;|&\n\r()`{}]/).map((part) => {
    let words = (part.match(/"[^"]*"?|'[^']*'?|\S+/g) || []).map((w) => w.replace(/["']/g, '')).filter(Boolean);
    for (;;) {
      if (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) { words.shift(); continue; }
      if (WRAPPERS.has(exeName(words[0] ?? ''))) {
        words.shift();
        while (/^(?:-|\/[A-Za-z?]+$)/.test(words[0] ?? '')) words.shift();
        if (/\s/.test(words[0] ?? '')) words = [...words[0].trim().split(/\s+/), ...words.slice(1)];
        continue;
      }
      if (PM.has(exeName(words[0] ?? '')) && ['dlx', 'exec', 'x'].includes(words[1])) { words.splice(0, 2); continue; }
      break;
    }
    if (words.length) words[0] = exeName(words[0]);
    return words;
  }).filter((w) => w.length);
}

runHook('gate-commands', (input, { config, broken }) => {
  const command = input.tool_input?.command;
  const patterns = broken ? DEFAULT_GATED : config.gated_commands;
  if (typeof command !== 'string' || !Array.isArray(patterns)) return null;
  const segs = segments(command);
  const publish = segs.some((t) => PM.has(t[0]) && t.includes('publish'));
  for (const pattern of [...patterns, ...(publish ? ['package-manager publish'] : [])]) {
    const p = String(pattern).trim();
    if (!p) continue;
    const re = globToRegex(p, false);
    const significant = p.toLowerCase().split(/[\s*?]+/).filter(Boolean);
    const hit = p === 'package-manager publish' || segs.some((tokens) => {
      if (re.test(tokens.join(' '))) return true;
      if (!significant.length || tokens[0].toLowerCase() !== significant[0]) return false;
      let next = 1;
      for (const t of tokens.slice(1)) if (t.toLowerCase() === significant[next]) next++;
      return next === significant.length;
    });
    if (hit) {
      const shown = command.length > 200 ? command.slice(0, 200) + '...' : command;
      const why = broken
        ? 'config broken (.studio/project.json unparseable; built-in gated list applied)'
        : `command matches gated pattern "${p}"`;
      return preToolUse({ permissionDecision: 'ask', permissionDecisionReason: `coding-claude: ${why}: ${shown}` });
    }
  }
  return null;
}, () => preToolUse({ permissionDecision: 'ask', permissionDecisionReason: 'coding-claude: command too complex to check' }));
