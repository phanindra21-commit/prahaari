import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted recursively, arrays keep order,
 * Dates as ISO strings.
 *
 * `before`/`after` audit payloads sometimes carry live Mongoose documents
 * or DocumentArrays (e.g. a Recommendation's `phasing` subdocument array)
 * rather than plain objects — their internal proxies/getters recurse far
 * deeper than any real document depth and blow the call stack in
 * `sortKeysDeep`. Round-tripping through JSON first invokes each
 * Mongoose object's own `toJSON()`, producing a plain, finite value tree
 * before the (Mongoose-unaware) recursive sort runs over it.
 */
export function canonicalize(value: unknown): string {
  const plain = value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
  return JSON.stringify(sortKeysDeep(plain));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      sorted[key] = sortKeysDeep(val);
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export const GENESIS_HASH = "GENESIS";
