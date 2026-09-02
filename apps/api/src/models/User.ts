import { Schema, model, type Document, type Types } from "mongoose";
import { USER_ROLES, type UserRole } from "@punarvas/shared";

export interface UserScope {
  state?: string;
  districtId?: Types.ObjectId;
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  scope: { state?: string; districtId?: string };
  isActive: boolean;
  lastLoginAt: Date | null;
}

export interface UserDoc extends Document {
  name: string;
  email: string;
  /** Never selected by default — see `select: false` below. Use `.select("+passwordHash")` to fetch it. */
  passwordHash: string;
  role: UserRole;
  scope: UserScope;
  isActive: boolean;
  lastLoginAt: Date | null;
  /** Bumped to force logout everywhere: any access token whose tokenVersion != this value is rejected. */
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  toSafeJSON(): SafeUser;
}

const userScopeSchema = new Schema<UserScope>(
  {
    state: { type: String },
    districtId: { type: Schema.Types.ObjectId, ref: "District" },
  },
  { _id: false },
);

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true },
    scope: { type: userScopeSchema, required: true, default: () => ({}) },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date, default: null },
    tokenVersion: { type: Number, required: true, default: 0 },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.methods.toSafeJSON = function toSafeJSON(this: UserDoc): SafeUser {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    scope: {
      ...(this.scope.state ? { state: this.scope.state } : {}),
      ...(this.scope.districtId ? { districtId: this.scope.districtId.toString() } : {}),
    },
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt,
  };
};

export const User = model<UserDoc>("User", userSchema, "users");
