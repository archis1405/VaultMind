/**
 * Lexical tokenizer for BM25. Deliberately simple and deterministic: lowercase,
 * then pull out maximal runs of letters/digits. No stemming or stopword removal —
 * BM25's IDF term already down-weights common words, and keeping tokenization
 * transparent makes the ranking behavior predictable (and unit-testable).
 *
 * `"The cats sat on the MAT!"` → `["the","cats","sat","on","the","mat"]`
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
