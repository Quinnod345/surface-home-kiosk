// Node >=23 removed the long-deprecated util type helpers that older tfjs builds
// still call. Restore the ones tfjs/face-api use so the service runs on any Node.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const util = require("util");
const shims = {
  isNullOrUndefined: (v) => v === null || v === undefined,
  isNull: (v) => v === null,
  isUndefined: (v) => v === undefined,
  isString: (v) => typeof v === "string",
  isNumber: (v) => typeof v === "number",
  isBoolean: (v) => typeof v === "boolean",
  isFunction: (v) => typeof v === "function",
  isObject: (v) => v !== null && typeof v === "object",
  isArray: Array.isArray,
  isPrimitive: (v) => v === null || (typeof v !== "object" && typeof v !== "function"),
  isBuffer: (v) => Buffer.isBuffer(v),
};
for (const [k, fn] of Object.entries(shims)) if (typeof util[k] !== "function") util[k] = fn;
