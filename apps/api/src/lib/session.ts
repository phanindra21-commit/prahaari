import { Types } from "mongoose";
import { User, type UserDoc } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { audit } from "./audit";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshTokenSignature,
  hashRefreshToken,
  InvalidTokenError,
} from "./tokens";

export interface RequestMeta {
  requestId: string;
  ipAddress: string;
  userAgent: string;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export class RefreshTokenReuseError extends Error {}
export class RefreshTokenInvalidError extends Error {}

/** Issues a fresh access+refresh pair. Pass `family` when rotating an existing session; omit it for a brand-new login. */
export async function issueTokenPair(
  user: Pick<UserDoc, "_id" | "role" | "scope" | "tokenVersion">,
  meta: RequestMeta,
  family?: Types.ObjectId,
): Promise<TokenPair & { refreshTokenDocId: Types.ObjectId }> {
  const tokenFamily = family ?? new Types.ObjectId();
  const access = signAccessToken(user);
  const refresh = signRefreshToken(user._id as Types.ObjectId, tokenFamily);
  const tokenHash = hashRefreshToken(refresh.token);

  const created = await RefreshToken.create({
    userId: user._id,
    tokenHash,
    family: tokenFamily,
    expiresAt: refresh.expiresAt,
    revokedAt: null,
    replacedBy: null,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
    refreshTokenDocId: created._id,
  };
}

/**
 * Verifies + rotates a refresh token: revokes the presented token and
 * issues a new pair in the same family. If the presented token was
 * ALREADY revoked, that is treated as theft (a stolen token being reused
 * after the legitimate client already rotated past it) — the entire
 * family is revoked, the user's tokenVersion is bumped (forcing every
 * outstanding access token to fail verification), and a CRITICAL audit
 * entry is written.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: RequestMeta,
): Promise<{ pair: TokenPair; user: UserDoc }> {
  let payload;
  try {
    payload = verifyRefreshTokenSignature(rawToken);
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw new RefreshTokenInvalidError(error.message);
    }
    throw error;
  }

  const tokenHash = hashRefreshToken(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash });
  if (!stored) {
    throw new RefreshTokenInvalidError("Refresh token not recognized");
  }

  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { family: stored.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    const user = await User.findByIdAndUpdate(
      stored.userId,
      { $inc: { tokenVersion: 1 } },
      { new: true },
    );
    await audit({
      actorId: stored.userId,
      actorLabel: user?.email ?? stored.userId.toString(),
      action: "TOKEN_REUSE_DETECTED",
      entityType: "User",
      entityId: stored.userId,
      before: null,
      after: { revokedFamily: stored.family.toString() },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      severity: "CRITICAL",
    });
    throw new RefreshTokenReuseError("Refresh token reuse detected — session family revoked");
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw new RefreshTokenInvalidError("Refresh token expired");
  }

  if (stored.userId.toString() !== payload.sub || stored.family.toString() !== payload.family) {
    throw new RefreshTokenInvalidError("Refresh token does not match its stored record");
  }

  const user = await User.findById(stored.userId);
  if (!user || !user.isActive) {
    throw new RefreshTokenInvalidError("User not found or inactive");
  }

  const newPair = await issueTokenPair(user, meta, stored.family);
  stored.revokedAt = new Date();
  stored.replacedBy = newPair.refreshTokenDocId;
  await stored.save();

  await audit({
    actorId: user._id as Types.ObjectId,
    actorLabel: user.email,
    action: "TOKEN_ROTATED",
    entityType: "User",
    entityId: user._id as Types.ObjectId,
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    severity: "INFO",
  });

  return {
    pair: {
      accessToken: newPair.accessToken,
      accessTokenExpiresAt: newPair.accessTokenExpiresAt,
      refreshToken: newPair.refreshToken,
      refreshTokenExpiresAt: newPair.refreshTokenExpiresAt,
    },
    user,
  };
}

/** Revokes a single refresh token (plain logout — the rest of the session's other devices stay logged in). */
export async function revokeSingleToken(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Revokes every refresh token for a user and bumps tokenVersion, forcing logout on every device. */
export async function revokeAllSessions(
  userId: Types.ObjectId,
  meta: RequestMeta,
  actorLabel: string,
): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
  await audit({
    actorId: userId,
    actorLabel,
    action: "LOGOUT_ALL",
    entityType: "User",
    entityId: userId,
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    severity: "WARNING",
  });
}
