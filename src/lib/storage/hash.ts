/**
 * SHA-256 of a string as lowercase hex, via Web Crypto (available on the main
 * thread, in workers, and in Node 20+ for tests). Used as a note's content
 * fingerprint: if the hash matches what we stored last time, the note is
 * unchanged and its chunks + embeddings can be reused verbatim.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
