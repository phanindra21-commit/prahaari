import { Schema, model, type Document, type Types } from "mongoose";
import { USER_ROLES, type UserRole } from "@punarvas/shared";

export interface UserScope {
  state?: string;
  districtId?: Types.ObjectId;
}

export interface UserDoc extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  scope: UserScope;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true },
    scope: { type: userScopeSchema, required: true, default: () => ({}) },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model<UserDoc>("User", userSchema, "users");
