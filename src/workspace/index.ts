// Squad workspace: the service layer behind the squad builder, Chemistry Surgeon and Squad Optimizer.
// Worker/Deno-safe: no Node-only imports, no DB clients.
export * from "./types.js";
export * from "./formations.js";
export * from "./fit.js";
export * from "./squad.js";
export * from "./surgeon.js";
export * from "./optimizer.js";
export * from "./compare.js";
export * from "./store.js";
export * from "./schema.js";
export * from "./service.js";
export { DEFAULT_RULES, FC27_COMMUNITY_V1 } from "./default-rules.js";
