import type { RequestHandler } from "express";
import type { Types } from "mongoose";
import { verifyAccessToken, InvalidTokenError } from "../lib/tokens";
import { User } from "../models/User";

/** Requires a valid `Authorization: Bearer <accessToken>` header; rejects if the user's tokenVersion has since been bumped (forced logout). */
export const authenticate: RequestHandler = (req, res, next) => {
  void (async () => {
    const header = req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer access token" });
      return;
    }
    const token = header.slice("Bearer ".length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      const message = error instanceof InvalidTokenError ? error.message : "Invalid token";
      res.status(401).json({ error: message });
      return;
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      res.status(401).json({ error: "User not found or inactive" });
      return;
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      res.status(401).json({ error: "Token has been revoked — please log in again" });
      return;
    }

    req.auth = {
      userId: user._id as Types.ObjectId,
      role: user.role,
      scope: {
        ...(user.scope.state ? { state: user.scope.state } : {}),
        ...(user.scope.districtId ? { districtId: user.scope.districtId.toString() } : {}),
      },
      tokenVersion: user.tokenVersion,
    };
    next();
  })().catch(next);
};
