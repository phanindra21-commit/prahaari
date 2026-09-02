import type { Types } from "mongoose";
import { AuditLog, type AuditLogDoc, type AuditSeverity } from "../models/AuditLog";
import { canonicalize, sha256Hex, GENESIS_HASH } from "./hashChain";

export interface AuditEntryContent {
  seq: number;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  severity: AuditSeverity;
  timestamp: string;
  prevHash: string;
}

/**
 * entryHash = sha256( canonicalJSON(entry-without-entryHash) + prevHash ).
 * `prevHash` is both a field inside the canonicalized content AND appended
 * again as a suffix — this is the literal hash-chain construction this
 * project specified; the redundancy is harmless (it does not weaken the
 * chain) and keeps the formula trivial to re-derive in verify-chain.
 */
export function computeEntryHash(content: AuditEntryContent): string {
  return sha256Hex(canonicalize(content) + content.prevHash);
}

export interface AuditInput {
  actorId: Types.ObjectId | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId?: Types.ObjectId | null;
  before?: unknown;
  after?: unknown;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  severity?: AuditSeverity;
}

const MAX_SEQ_CONFLICT_RETRIES = 5;

/**
 * The ONLY supported way to write an AuditLog entry. Computes the next
 * `seq`/`prevHash`/`entryHash` against the current chain tip and inserts
 * (append-only — see the model's mutation guards). Retries a small number
 * of times on a `seq` collision (two concurrent writers reading the same
 * chain tip); this is a best-effort mitigation appropriate for a
 * single-process hackathon deployment, not a distributed-lock guarantee —
 * see docs/SECURITY.md "known limitations".
 */
export async function audit(input: AuditInput): Promise<AuditLogDoc> {
  for (let attempt = 0; attempt < MAX_SEQ_CONFLICT_RETRIES; attempt += 1) {
    const tip = await AuditLog.findOne({}, { seq: 1, entryHash: 1 }, { sort: { seq: -1 } }).lean();
    const seq = tip ? tip.seq + 1 : 0;
    const prevHash = tip ? tip.entryHash : GENESIS_HASH;
    const timestamp = new Date();

    const content: AuditEntryContent = {
      seq,
      actorId: input.actorId ? input.actorId.toString() : null,
      actorLabel: input.actorLabel,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ? input.entityId.toString() : null,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      severity: input.severity ?? "INFO",
      timestamp: timestamp.toISOString(),
      prevHash,
    };
    const entryHash = computeEntryHash(content);

    try {
      return await AuditLog.create({
        seq,
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        severity: input.severity ?? "INFO",
        timestamp,
        prevHash,
        entryHash,
      });
    } catch (error) {
      const isDuplicateSeq =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 11000;
      if (isDuplicateSeq && attempt < MAX_SEQ_CONFLICT_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("[audit] Failed to append audit entry after retrying seq conflicts");
}

export interface ChainVerificationResult {
  valid: boolean;
  entriesChecked: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Walks the whole hash chain in seq order, recomputing entryHash from
 * each stored entry's own fields and checking prevHash linkage, and
 * reports the first broken link (if any). A document edited directly in
 * MongoDB (bypassing the Mongoose append-only guards entirely) is exactly
 * the class of tampering this is designed to catch — see
 * GET /api/v1/audit/verify-chain.
 */
export async function verifyAuditChain(): Promise<ChainVerificationResult> {
  const entries = await AuditLog.find({}, {}, { sort: { seq: 1 } }).lean();

  let expectedPrevHash = GENESIS_HASH;
  let checked = 0;

  for (const entry of entries) {
    checked += 1;

    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtSeq: entry.seq,
        reason: "prevHash does not match the previous entry's entryHash",
      };
    }

    const content: AuditEntryContent = {
      seq: entry.seq,
      actorId: entry.actorId ? entry.actorId.toString() : null,
      actorLabel: entry.actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ? entry.entityId.toString() : null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: entry.requestId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      severity: entry.severity,
      timestamp: entry.timestamp.toISOString(),
      prevHash: entry.prevHash,
    };
    const recomputedHash = computeEntryHash(content);

    if (recomputedHash !== entry.entryHash) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtSeq: entry.seq,
        reason:
          "entryHash does not match the recomputed hash — this entry's stored fields were altered after being written",
      };
    }

    expectedPrevHash = entry.entryHash;
  }

  return { valid: true, entriesChecked: checked, brokenAtSeq: null, reason: null };
}
