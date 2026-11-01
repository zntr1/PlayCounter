// Each scan checks every process against the same ignore list (about 1,200
// entries) several times, so the wildcard patterns of a set are compiled into
// one regex the first time the set is used. Store sets are replaced on change,
// never edited in place.
const compiledWildcards = new WeakMap<ReadonlySet<string>, RegExp | null>();

export function matchesProcessPatternSet(
  exeName: string,
  patterns: ReadonlySet<string>,
) {
  const key = exeName.toLowerCase();
  if (patterns.has(key)) return true;

  return wildcardRegex(patterns)?.test(key) ?? false;
}

function wildcardRegex(patterns: ReadonlySet<string>) {
  let regex = compiledWildcards.get(patterns);
  if (regex === undefined) {
    const sources = [...patterns].filter(hasWildcard).map(wildcardSource);
    regex =
      sources.length > 0 ? new RegExp(`^(?:${sources.join("|")})$`) : null;
    compiledWildcards.set(patterns, regex);
  }
  return regex;
}

function hasWildcard(pattern: string) {
  return pattern.includes("*") || pattern.includes("?");
}

function wildcardSource(pattern: string) {
  let regex = "";
  for (const char of pattern) {
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += escapeRegexChar(char);
    }
  }
  return regex;
}

function escapeRegexChar(char: string) {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}
