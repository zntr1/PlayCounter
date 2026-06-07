export function matchesProcessPatternSet(
  exeName: string,
  patterns: Set<string>,
) {
  const key = exeName.toLowerCase();
  if (patterns.has(key)) return true;

  for (const pattern of patterns) {
    if (hasWildcard(pattern) && matchesWildcardPattern(key, pattern)) {
      return true;
    }
  }

  return false;
}

function hasWildcard(pattern: string) {
  return pattern.includes("*") || pattern.includes("?");
}

function matchesWildcardPattern(value: string, pattern: string) {
  let regex = "^";
  for (const char of pattern) {
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += escapeRegexChar(char);
    }
  }
  regex += "$";

  return new RegExp(regex).test(value);
}

function escapeRegexChar(char: string) {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}
