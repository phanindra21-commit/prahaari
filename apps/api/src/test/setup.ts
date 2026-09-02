import { beforeAll, afterAll, afterEach } from "vitest";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../lib/db";

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI not set — did globalSetup run?");
  }
  await connectDb(uri);
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await disconnectDb();
});
