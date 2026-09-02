import { describe, it, expect } from "vitest";
import { District } from "../models/District";

describe("test infrastructure smoke test", () => {
  it("connects to the in-memory MongoDB and can write/read a document", async () => {
    const doc = await District.create({
      lgdCode: "SMOKE-001",
      name: "Smoke District",
      state: "Testland",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      population: 100,
      areaSqKm: 10,
      primaryHazards: ["flood"],
      dmAuthorityContact: { name: "Test", designation: "Tester", phone: "0000000000" },
    });

    const found = await District.findById(doc._id);
    expect(found?.name).toBe("Smoke District");
  });
});
