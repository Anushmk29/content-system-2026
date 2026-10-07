// Shared helper for recovering a JSON object from a (possibly noisy) LLM response.
// LLMs wrap JSON in prose or ```fences```; this finds the first balanced top-level
// object, ignoring braces inside strings. Pure + dependency-free → unit-tested.

// Chars that legally follow a string's real closing quote in JSON (after whitespace).
const CLOSES_STRING = new Set([',', '}', ']', ':', undefined]);

export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('no JSON object found in response');
  let depth = 0, inStr = false, esc = false;
  let out = '';
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        out += ch;
      } else if (ch === '\\') {
        esc = true;
        out += ch;
      } else if (ch === '"') {
        // LLMs often forget to escape a literal quote used mid-sentence (emphasis,
        // a quoted word). A *real* closing quote is always followed (after any
        // whitespace) by a JSON structural character; anything else means this is
        // an embedded quote that needs escaping, not a string terminator.
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j]!)) j++;
        if (CLOSES_STRING.has(raw[j])) {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
      } else {
        out += ch;
      }
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === '{') {
      depth++;
      out += ch;
    } else if (ch === '}') {
      depth--;
      out += ch;
      if (depth === 0) return out;
    } else {
      out += ch;
    }
  }
  throw new Error('unbalanced JSON object in response');
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  return JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
}
