import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import type { Types } from "mongoose";
import type { UserRole } from "@punarvas/shared";
import { env } from "./env";
import type { UserDoc } from "../models/User";

export class InvalidTokenError extends Error {}

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  scope: { state?: string; districtId?: string };
  tokenVersion: number;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

function decodeExpiry(token: string): Date {
  const decoded = jwt.decode(token);
  if (typeof decoded !== "object" || decoded === null || typeof decoded.exp !== "number") {
    throw new InvalidTokenError("Signed token is missing an exp claim");
  }
  return new Date(decoded.exp * 1000);
}

export function signAccessToken(
  user: Pick<UserDoc, "_id" | "role" | "scope" | "tokenVersion">,
): SignedToken {
  const payload: AccessTokenPayload = {
    sub: user._id.toString(),
    role: user.role,
    scope: {
      ...(user.scope.state ? { state: user.scope.state } : {}),
      ...(user.scope.districtId ? { districtId: user.scope.districtId.toString() } : {}),
    },
    tokenVersion: user.tokenVersion,
  };
  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
  return { token, expiresAt: decodeExpiry(token) };
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.tokenVersion === "number" &&
    (candidate.scope === undefined || typeof candidate.scope === "object")
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    throw new InvalidTokenError("Invalid or expired access token");
  }
  if (!isAccessTokenPayload(decoded)) {
    throw new InvalidTokenError("Malformed access token payload");
  }
  return {
    sub: decoded.sub,
    role: decoded.role,
    scope: decoded.scope ?? {},
    tokenVersion: decoded.tokenVersion,
  };
}

export interface RefreshTokenPayload {
  sub: string;
  family: string;
  jti: string;
}

export function signRefreshToken(userId: Types.ObjectId, family: Types.ObjectId): SignedToken {
  const payload: RefreshTokenPayload = {
    sub: userId.toString(),
    family: family.toString(),
    jti: randomBytes(16).toString("hex"),
  };
  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
  return { token, expiresAt: decodeExpiry(token) };
}

function isRefreshTokenPayload(value: unknown): value is RefreshTokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === "string" &&
    typeof candidate.family === "string" &&
    typeof candidate.jti === "string"
  );
}

export function verifyRefreshTokenSignature(token: string): RefreshTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw new InvalidTokenError("Invalid or expired refresh token");
  }
  if (!isRefreshTokenPayload(decoded)) {
    throw new InvalidTokenError("Malformed refresh token payload");
  }
  return decoded;
}

/** Refresh tokens are stored hashed — a DB read (or leak) never yields a usable token. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
