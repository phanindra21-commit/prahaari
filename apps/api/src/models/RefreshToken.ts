import { Schema, model, type Document, type Types } from "mongoose";

/**
 * One row per issued refresh token, stored HASHED (never the raw token —
 * see apps/api/src/lib/tokens.ts). `family` is generated once at login and
 * carried through every rotation of that session, so reuse detection
 * (presenting an already-revoked token) can revoke the whole family in a
 * single query — see apps/api/src/lib/tokens.ts `rotateRefreshToken`.
 */
export interface RefreshTokenDoc extends Document {
  userId: Types.ObjectId;
  tokenHash: string;
  family: Types.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: Types.ObjectId | null;
  userAgent: string;
  ipAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, ref: "RefreshToken", default: null },
    userAgent: { type: String, required: true },
    ipAddress: { type: String, required: true },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, family: 1 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDoc>(
  "RefreshToken",
  refreshTokenSchema,
  "refreshTokens",
);
