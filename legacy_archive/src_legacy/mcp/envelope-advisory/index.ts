// src/mcp/envelope-advisory/index.ts
//
// Barrel for the envelope-advisory cluster. Re-exports the public
// surface — currently the truncation notice helper consumed by the
// supervisor-context pack handler.
export { buildTruncationNotice } from "./truncation-notice.js";