import { Router, type Request, type Response } from "express";
import { loginRequestSchema, changePasswordRequestSchema } from "@prahari/shared";
import { User } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { verifyPassword, hashPassword } from "../lib/password";
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeSingleToken,
  revokeAllSessions,
  RefreshTokenReuseError,
  RefreshTokenInvalidError,
  type RequestMeta,
} from "../lib/session";
import { audit } from "../lib/audit";
import { authenticate } from "../middleware/authenticate";
import { loginRateLimiter, refreshRateLimiter } from "../middleware/rateLimiters";
import { cookieSecure } from "../lib/env";

export const authRouter = Router();

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const MAX_FAILED_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

function requestMeta(req: Request): RequestMeta {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? "unknown",
    userAgent: req.header("User-Agent") ?? "unknown",
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure,
    expires: expiresAt,
    path: REFRESH_COOKIE_PATH,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

function getRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}

authRouter.post("/login", loginRateLimiter, (req, res, next) => {
  void (async () => {
    const { email, password } = loginRequestSchema.parse(req.body);
    const meta = requestMeta(req);
    const normalizedEmail = email.toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");

    if (!user) {
      await audit({
        actorId: null,
        actorLabel: normalizedEmail,
        action: "LOGIN_FAILURE",
        entityType: "User",
        entityId: null,
        after: { reason: "user_not_found" },
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        severity: "WARNING",
      });
      res.locals.auditHandled = true;
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await audit({
        actorId: user._id,
        actorLabel: user.email,
        action: "LOGIN_BLOCKED_LOCKED",
        entityType: "User",
        entityId: user._id,
        after: { lockedUntil: user.lockedUntil },
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        severity: "WARNING",
      });
      res.locals.auditHandled = true;
      res
        .status(423)
        .json({ error: "Account locked. Try again later or ask a SUPER_ADMIN to unlock it." });
      return;
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      user.failedLoginAttempts += 1;
      let justLocked = false;
      if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        justLocked = true;
      }
      await user.save();

      await audit({
        actorId: user._id,
        actorLabel: user.email,
        action: justLocked ? "ACCOUNT_LOCKED" : "LOGIN_FAILURE",
        entityType: "User",
        entityId: user._id,
        after: { failedLoginAttempts: user.failedLoginAttempts, lockedUntil: user.lockedUntil },
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        severity: justLocked ? "CRITICAL" : "WARNING",
      });
      res.locals.auditHandled = true;
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const pair = await issueTokenPair(user, meta);
    setRefreshCookie(res, pair.refreshToken, pair.refreshTokenExpiresAt);

    await audit({
      actorId: user._id,
      actorLabel: user.email,
      action: "LOGIN_SUCCESS",
      entityType: "User",
      entityId: user._id,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      severity: "INFO",
    });
    res.locals.auditHandled = true;

    res.status(200).json({
      accessToken: pair.accessToken,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
      user: user.toSafeJSON(),
    });
  })().catch(next);
});

authRouter.post("/refresh", refreshRateLimiter, (req, res, next) => {
  void (async () => {
    const meta = requestMeta(req);
    const token = getRefreshCookie(req);
    if (!token) {
      res.status(401).json({ error: "Missing refresh token" });
      return;
    }

    try {
      const { pair } = await rotateRefreshToken(token, meta);
      setRefreshCookie(res, pair.refreshToken, pair.refreshTokenExpiresAt);
      res.locals.auditHandled = true; // rotateRefreshToken already wrote TOKEN_ROTATED
      res.status(200).json({
        accessToken: pair.accessToken,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
      });
    } catch (error) {
      clearRefreshCookie(res);
      res.locals.auditHandled = true; // reuse detection already wrote a CRITICAL entry inside rotateRefreshToken
      if (error instanceof RefreshTokenReuseError || error instanceof RefreshTokenInvalidError) {
        res.status(401).json({ error: error.message });
        return;
      }
      throw error;
    }
  })().catch(next);
});

authRouter.post("/logout", (req, res, next) => {
  void (async () => {
    const meta = requestMeta(req);
    const token = getRefreshCookie(req);
    if (token) {
      await revokeSingleToken(token);
    }
    clearRefreshCookie(res);

    await audit({
      actorId: req.auth?.userId ?? null,
      actorLabel: req.auth ? req.auth.userId.toString() : "anonymous",
      action: "LOGOUT",
      entityType: "User",
      entityId: req.auth?.userId ?? null,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      severity: "INFO",
    });
    res.locals.auditHandled = true;

    res.status(200).json({ loggedOut: true });
  })().catch(next);
});

authRouter.post("/logout-all", authenticate, (req, res, next) => {
  void (async () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const meta = requestMeta(req);
    await revokeAllSessions(req.auth.userId, meta, req.auth.userId.toString());
    clearRefreshCookie(res);
    res.locals.auditHandled = true; // revokeAllSessions already wrote LOGOUT_ALL
    res.status(200).json({ loggedOut: true });
  })().catch(next);
});

authRouter.get("/me", authenticate, (req, res, next) => {
  void (async () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const user = await User.findById(req.auth.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json({ user: user.toSafeJSON() });
  })().catch(next);
});

authRouter.post("/change-password", authenticate, (req, res, next) => {
  void (async () => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { currentPassword, newPassword } = changePasswordRequestSchema.parse(req.body);
    const meta = requestMeta(req);

    const user = await User.findById(req.auth.userId).select("+passwordHash");
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    user.passwordHash = await hashPassword(newPassword);
    user.tokenVersion += 1;
    await user.save();
    // A password change forces logout everywhere, not just other devices'
    // access tokens (tokenVersion covers that) — also revoke every
    // outstanding refresh token so they cannot silently mint new ones.
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    clearRefreshCookie(res);

    await audit({
      actorId: user._id,
      actorLabel: user.email,
      action: "PASSWORD_CHANGE",
      entityType: "User",
      entityId: user._id,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      severity: "WARNING",
    });
    res.locals.auditHandled = true;

    res.status(200).json({ changed: true });
  })().catch(next);
});
