/**
 * The merge gate: one verdict over a surface's comments, the connector kind
 * that publishes it, and the publishing itself. `docs/gate.md` is the design.
 */

export {
  ADVISORY_AUTHORS,
  BLOCKING_STATUSES,
  decideGate,
  isAdvisory,
  isAdvisoryId,
} from "./decide.js";
export type { GateOptions } from "./decide.js";
export { publishGate } from "./publish.js";
export type { GateContext } from "./publish.js";
