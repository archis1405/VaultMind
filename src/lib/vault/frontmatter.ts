import yaml from "js-yaml";

export interface ParsedFrontmatter {
  /** Parsed YAML as a plain object. Empty when absent or unparseable. */
  frontmatter: Record<string, unknown>;
  /** The markdown body with the frontmatter block removed. */
  body: string;
}

/**
 * Matches a leading YAML frontmatter block delimited by `---` lines, exactly as
 * Obsidian / Jekyll define it:
 *   - must be the very first thing in the file (no leading blank lines)
 *   - opening `---` and closing `---`/`...` each on their own line
 *
 * Group 1 = the YAML source between the fences (possibly empty).
 *
 * The `m` flag lets `^` anchor the *closing* fence to the start of a line, so:
 *   - an empty block (`---\n---\n`) matches with an empty capture, and
 *   - a `---` appearing mid-line in the body is never mistaken for the close.
 * Non-greedy `[\s\S]*?` picks the first such closing line. `(?:\r?\n|$)` accepts
 * both CRLF (Windows-authored notes) and a file that ends right at the fence.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;

/**
 * Split a raw markdown file into its parsed frontmatter and its body.
 *
 * Pure and total: it never throws. If the YAML is malformed we swallow the
 * error, treat the note as having no frontmatter, and keep the original text as
 * the body — a single bad note must not abort a whole-vault ingest.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const [fullMatch, yamlSource] = match;
  const body = raw.slice(fullMatch.length);

  try {
    const parsed = yaml.load(yamlSource);
    // YAML can legally parse to a scalar, null, or array; we only treat a plain
    // object as usable frontmatter. Anything else → empty (but still strip it).
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
    return { frontmatter: {}, body };
  } catch {
    // Malformed YAML: don't strip anything we can't understand — keep raw body.
    return { frontmatter: {}, body: raw };
  }
}
