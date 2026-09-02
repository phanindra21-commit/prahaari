import { describe, it, expect } from "vitest";
import mongoose, { Types } from "mongoose";
import { audit, verifyAuditChain } from "./audit";
import { AuditLog } from "../models/AuditLog";

describe("audit() and the hash chain (Step 3 Part D3)", () => {
  it("writes the first entry with prevHash = GENESIS", async () => {
    await audit({
      actorId: null,
      actorLabel: "system",
      action: "FIRST",
      entityType: "Test",
      requestId: "r1",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    const entry = await AuditLog.findOne({ seq: 0 }).lean();
    expect(entry?.prevHash).toBe("GENESIS");
    expect(entry?.entryHash).toBeTruthy();
  });

  it("chains entryHash -> prevHash across consecutive writes", async () => {
    const first = await audit({
      actorId: null,
      actorLabel: "system",
      action: "A",
      entityType: "Test",
      requestId: "r1",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    const second = await audit({
      actorId: null,
      actorLabel: "system",
      action: "B",
      entityType: "Test",
      requestId: "r2",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(second.prevHash).toBe(first.entryHash);
  });

  it("verifyAuditChain reports valid:true for an untouched chain", async () => {
    for (let i = 0; i < 5; i += 1) {
      await audit({
        actorId: new Types.ObjectId(),
        actorLabel: `user-${i}`,
        action: "SOME_ACTION",
        entityType: "Test",
        entityId: new Types.ObjectId(),
        requestId: `r${i}`,
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      });
    }
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5);
    expect(result.brokenAtSeq).toBeNull();
  });

  it("verifyAuditChain catches a directly-tampered field (bypassing the Mongoose guards)", async () => {
    await audit({
      actorId: null,
      actorLabel: "system",
      action: "A",
      entityType: "Test",
      requestId: "r1",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    await audit({
      actorId: null,
      actorLabel: "system",
      action: "B",
      entityType: "Test",
      requestId: "r2",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    const tampered = await audit({
      actorId: null,
      actorLabel: "system",
      action: "C",
      entityType: "Test",
      requestId: "r3",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    // Simulate an attacker with direct DB access editing a stored field —
    // this goes through the native driver, bypassing every Mongoose guard.
    await mongoose.connection.collections.auditLogs?.updateOne(
      { _id: tampered._id },
      { $set: { action: "TAMPERED_ACTION" } },
    );

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(tampered.seq);
    expect(result.reason).toMatch(/entryHash/i);
  });

  it("verifyAuditChain catches a broken prevHash link", async () => {
    await audit({
      actorId: null,
      actorLabel: "system",
      action: "A",
      entityType: "Test",
      requestId: "r1",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });
    const second = await audit({
      actorId: null,
      actorLabel: "system",
      action: "B",
      entityType: "Test",
      requestId: "r2",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    await mongoose.connection.collections.auditLogs?.updateOne(
      { _id: second._id },
      { $set: { prevHash: "forged-prev-hash" } },
    );

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(second.seq);
    expect(result.reason).toMatch(/prevHash/i);
  });
});
