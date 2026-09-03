import { Router } from "express";
import { authRouter } from "./auth.routes";
import { auditRouter } from "./audit.routes";
import { zoningRouter } from "./zoning.routes";

export const apiV1Router = Router();
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/audit", auditRouter);
apiV1Router.use(zoningRouter);
