import { buildApp } from "./app.js";
import { loadDotEnv } from "./env.js";
import { createRepository } from "./repository.js";

loadDotEnv();

const app = await buildApp(createRepository());
const port = Number(process.env.PORT ?? 3003);
await app.listen({ host: "0.0.0.0", port });
