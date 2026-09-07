import { describe, it, expect, beforeEach } from "vitest";
import request, { type Response } from "supertest";
import { createApp } from "../app";
import { User } from "../models/User";
import { hashPassword } from "../lib/password";

const app = createApp();

const TEST_EMAIL = "officer.test@prahari.gov.in";
const TEST_PASSWORD = "CorrectHorseBattery9!";

async function seedUser(): Promise<void> {
  await User.create({
    name: "Test Officer",
    email: TEST_EMAIL,
    passwordHash: await hashPassword(TEST_PASSWORD),
    role: "DISTRICT_OFFICER",
    scope: {},
    isActive: true,
  });
}

function extractRefreshCookie(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown;
  const cookies: string[] = Array.isArray(raw) ? (raw as string[]) : [];
  const match = cookies.find((c) => c.startsWith("refreshToken="));
  if (!match) {
    throw new Error("No refreshToken cookie was set on the response");
  }
  return match.split(";")[0] as string;
}

describe("Auth routes integration (Step 3 Part B)", () => {
  beforeEach(async () => {
    await seedUser();
  });

  it("POST /login with correct credentials returns an access token and sets a refresh cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.0.0.1")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(extractRefreshCookie(res)).toMatch(/^refreshToken=.+/);
  });

  it("POST /login with wrong password is rejected and sets no cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.0.0.2")
      .send({ email: TEST_EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("GET /me requires a valid access token", async () => {
    const unauth = await request(app).get("/api/v1/auth/me");
    expect(unauth.status).toBe(401);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.0.0.3")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessTokenOf(login)}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(TEST_EMAIL);
  });

  it("locks the account after 10 consecutive failed logins from varying IPs (account-level, not the per-IP rate limiter)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.1.0.${i}`)
        .send({ email: TEST_EMAIL, password: "wrong-password" });
      expect(res.status).toBe(401);
    }
    const lockedRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.1.0.99")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(lockedRes.status).toBe(423);

    const user = await User.findOne({ email: TEST_EMAIL });
    expect(user?.lockedUntil).toBeTruthy();
    expect(user?.lockedUntil && user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("rate limits /login to 5 attempts per window for the same IP+email", async () => {
    const ip = "10.2.0.1";
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: TEST_EMAIL, password: "wrong-password" });
      expect(res.status).toBe(401);
    }
    const sixth = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: TEST_EMAIL, password: "wrong-password" });
    expect(sixth.status).toBe(429);
  });

  it("refresh rotation: a used refresh token is rejected, and reuse revokes the whole family", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.3.0.1")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const firstCookie = extractRefreshCookie(login);

    const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf("string");
    const secondCookie = extractRefreshCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);

    // Reusing the FIRST (already-rotated) token must be rejected...
    const reuse = await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie);
    expect(reuse.status).toBe(401);

    // ...and must revoke the whole family: the SECOND (legitimately rotated) token is now also dead.
    const secondAttempt = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", secondCookie);
    expect(secondAttempt.status).toBe(401);
  });

  it("logout revokes the refresh token so it can no longer be used", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.4.0.1")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookie = extractRefreshCookie(login);

    const logout = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie);
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("logout-all revokes every refresh token and bumps tokenVersion, invalidating other sessions' access tokens", async () => {
    const login1 = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.5.0.1")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const login2 = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.5.0.2")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const logoutAll = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${accessTokenOf(login1)}`)
      .set("Cookie", extractRefreshCookie(login1));
    expect(logoutAll.status).toBe(200);

    const meWithOtherSessionToken = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessTokenOf(login2)}`);
    expect(meWithOtherSessionToken.status).toBe(401);
  });

  it("change-password requires the correct current password and invalidates other sessions", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.6.0.1")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const wrongCurrent = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${accessTokenOf(login)}`)
      .send({ currentPassword: "not-the-real-password", newPassword: "NewPassword123!" });
    expect(wrongCurrent.status).toBe(401);

    const ok = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${accessTokenOf(login)}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "NewPassword123!" });
    expect(ok.status).toBe(200);

    const oldPasswordLogin = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.6.0.2")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.6.0.3")
      .send({ email: TEST_EMAIL, password: "NewPassword123!" });
    expect(newPasswordLogin.status).toBe(200);
  });
});

function accessTokenOf(res: Response): string {
  return res.body.accessToken as string;
}
