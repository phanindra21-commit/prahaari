import { MongoMemoryServer } from "mongodb-memory-server";

let mongod: MongoMemoryServer | undefined;

export async function setup(): Promise<void> {
  mongod = await MongoMemoryServer.create({ instance: { dbName: "punarvas-test" } });
  process.env.MONGODB_URI = mongod.getUri("punarvas-test");
  process.env.JWT_ACCESS_SECRET ??= "test-only-access-secret-not-for-real-use-00000000";
  process.env.JWT_REFRESH_SECRET ??= "test-only-refresh-secret-not-for-real-use-00000000";
  process.env.NODE_ENV = "test";
}

export async function teardown(): Promise<void> {
  await mongod?.stop();
}
