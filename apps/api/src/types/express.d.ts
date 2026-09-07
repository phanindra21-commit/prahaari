import type { Types } from "mongoose";
import type { UserRole } from "@prahari/shared";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: Types.ObjectId;
        role: UserRole;
        scope: { state?: string; districtId?: string };
        tokenVersion: number;
      };
      scopeFilter?: Record<string, unknown>;
    }
  }
}

export {};
