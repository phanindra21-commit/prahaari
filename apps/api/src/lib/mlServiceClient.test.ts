import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { MlServiceClient } from "./mlServiceClient";

const VALID_RESPONSE = {
  hazardType: "landslide",
  cellScores: [
    {
      h3Index: "886015b26dfffff",
      district: "wayanad",
      overlayScore: 0.4,
      mlScore: 0.5,
      blendedScore: 0.44,
      zoneClass: "Yellow",
      topFactors: [{ factor: "slope", contribution: 0.12, direction: "INCREASES_RISK" }],
    },
  ],
  zones: [
    {
      district: "wayanad",
      zoneClass: "Yellow",
      cellCount: 1,
      geometry: { type: "Polygon", coordinates: [[[76.0, 11.6], [76.1, 11.6], [76.1, 11.7], [76.0, 11.6]]] },
      simplifiedGeometry: {
        type: "Polygon",
        coordinates: [[[76.0, 11.6], [76.1, 11.6], [76.1, 11.7], [76.0, 11.6]]],
      },
    },
  ],
  metrics: { aucRoc: 0.6, precision: 0.5, recall: 0.5, f1: 0.5, calibrationError: 0.1 },
  featureList: ["slope"],
  trainingSampleCount: 10,
  labelSource: "SYNTHETIC_DEMO",
};

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(handler: RequestHandler): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("MlServiceClient", () => {
  it("returns the parsed response on success", async () => {
    const baseUrl = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(VALID_RESPONSE));
    });
    const client = new MlServiceClient({ baseUrl });

    const result = await client.runZoning("landslide", [
      { h3Index: "886015b26dfffff", district: "wayanad", lon: 76.1, lat: 11.7, factors: { slope: 20 } },
    ]);

    expect(result.hazardType).toBe("landslide");
    expect(result.cellScores).toHaveLength(1);
  });

  it("throws a clear error when the response fails Zod validation", async () => {
    const baseUrl = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hazardType: "landslide" })); // missing every other required field
    });
    const client = new MlServiceClient({ baseUrl, maxRetries: 0 });

    await expect(
      client.runZoning("landslide", [
        { h3Index: "a", district: "wayanad", lon: 76.1, lat: 11.7, factors: {} },
      ]),
    ).rejects.toThrow(/failed validation/);
  });

  it("does not retry a 4xx (deterministic client error)", async () => {
    let requestCount = 0;
    const baseUrl = await listen((req, res) => {
      requestCount += 1;
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "bad request" }));
    });
    const client = new MlServiceClient({ baseUrl, maxRetries: 3, initialBackoffMs: 5 });

    await expect(
      client.runZoning("landslide", [
        { h3Index: "a", district: "wayanad", lon: 76.1, lat: 11.7, factors: {} },
      ]),
    ).rejects.toThrow();
    expect(requestCount).toBe(1);
  });

  it("retries a 5xx up to maxRetries then throws", async () => {
    let requestCount = 0;
    const baseUrl = await listen((req, res) => {
      requestCount += 1;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "unavailable" }));
    });
    const client = new MlServiceClient({ baseUrl, maxRetries: 2, initialBackoffMs: 5 });

    await expect(
      client.runZoning("landslide", [
        { h3Index: "a", district: "wayanad", lon: 76.1, lat: 11.7, factors: {} },
      ]),
    ).rejects.toThrow();
    expect(requestCount).toBe(3); // initial attempt + 2 retries
  });

  it("succeeds after a transient 5xx followed by a 200", async () => {
    let requestCount = 0;
    const baseUrl = await listen((req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(503);
        res.end("temporarily unavailable");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(VALID_RESPONSE));
    });
    const client = new MlServiceClient({ baseUrl, maxRetries: 2, initialBackoffMs: 5 });

    const result = await client.runZoning("landslide", [
      { h3Index: "a", district: "wayanad", lon: 76.1, lat: 11.7, factors: {} },
    ]);
    expect(result.hazardType).toBe("landslide");
    expect(requestCount).toBe(2);
  });

  it("aborts and throws on a timeout", async () => {
    const baseUrl = await listen((_req, _res) => {
      // never respond
    });
    const client = new MlServiceClient({ baseUrl, timeoutMs: 100, maxRetries: 0 });

    await expect(
      client.runZoning("landslide", [
        { h3Index: "a", district: "wayanad", lon: 76.1, lat: 11.7, factors: {} },
      ]),
    ).rejects.toThrow();
  });
});
