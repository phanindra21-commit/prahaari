import { describe, it, expect } from "vitest";
import { AuditLog } from "./AuditLog";

const baseDoc = {
  seq: 0,
  actorId: null,
  actorLabel: "test",
  action: "TEST_ACTION",
  entityType: "Test",
  entityId: null,
  before: null,
  after: null,
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
  severity: "INFO" as const,
  timestamp: new Date(),
  prevHash: "GENESIS",
  entryHash: "abc123",
};

describe("AuditLog append-only guard (Step 3 Part A4)", () => {
  it("allows a plain insert", async () => {
    const doc = await AuditLog.create(baseDoc);
    expect(doc._id).toBeDefined();
  });

  it("blocks Document#save() on an existing (non-new) document", async () => {
    const doc = await AuditLog.create(baseDoc);
    doc.action = "MUTATED";
    await expect(doc.save()).rejects.toThrow(/append-only/i);
  });

  it("blocks updateOne", async () => {
    await AuditLog.create(baseDoc);
    await expect(AuditLog.updateOne({ seq: 0 }, { $set: { action: "MUTATED" } })).rejects.toThrow(
      /append-only/i,
    );
  });

  it("blocks updateMany", async () => {
    await AuditLog.create(baseDoc);
    await expect(AuditLog.updateMany({}, { $set: { action: "MUTATED" } })).rejects.toThrow(
      /append-only/i,
    );
  });

  it("blocks findOneAndUpdate", async () => {
    await AuditLog.create(baseDoc);
    await expect(
      AuditLog.findOneAndUpdate({ seq: 0 }, { $set: { action: "MUTATED" } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("blocks replaceOne", async () => {
    await AuditLog.create(baseDoc);
    await expect(
      AuditLog.replaceOne({ seq: 0 }, { ...baseDoc, action: "REPLACED" }),
    ).rejects.toThrow(/append-only/i);
  });

  it("blocks findOneAndReplace", async () => {
    await AuditLog.create(baseDoc);
    await expect(
      AuditLog.findOneAndReplace({ seq: 0 }, { ...baseDoc, action: "REPLACED" }),
    ).rejects.toThrow(/append-only/i);
  });

  it("blocks deleteOne", async () => {
    await AuditLog.create(baseDoc);
    await expect(AuditLog.deleteOne({ seq: 0 })).rejects.toThrow(/append-only/i);
  });

  it("blocks deleteMany", async () => {
    await AuditLog.create(baseDoc);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/i);
  });

  it("blocks findOneAndDelete", async () => {
    await AuditLog.create(baseDoc);
    await expect(AuditLog.findOneAndDelete({ seq: 0 })).rejects.toThrow(/append-only/i);
  });

  it("blocks bulkWrite if ANY operation in the batch is a non-insert", async () => {
    await expect(
      AuditLog.bulkWrite([
        { insertOne: { document: { ...baseDoc, seq: 1 } } },
        { updateOne: { filter: { seq: 0 }, update: { $set: { action: "X" } } } },
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("allows bulkWrite when every operation is insertOne", async () => {
    const result = await AuditLog.bulkWrite([
      { insertOne: { document: { ...baseDoc, seq: 2 } } },
      { insertOne: { document: { ...baseDoc, seq: 3 } } },
    ]);
    expect(result.insertedCount).toBe(2);
  });
});
