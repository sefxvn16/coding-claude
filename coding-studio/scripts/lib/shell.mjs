/** A quoted heredoc operator must be outside quotes and nested shell expressions. */
export function findHeredoc(line) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { depth = Math.max(0, depth - 1); continue; }
    if (depth || c !== '<' || line[i - 1] === '<') continue;
    const m = /^<<(-?)[ \t]*(['"])([A-Za-z_]\w*)\2/.exec(line.slice(i));
    if (m) return { index: i, length: m[0].length, marker: m[3], dash: !!m[1] };
  }
  return null;
}

export const collapse = (s) => String(s).trim().replace(/\s+/g, ' ');
