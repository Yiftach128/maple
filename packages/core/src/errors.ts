/**
 * A backend's own refusal, kept structured. A connector throws it when an HTTP
 * API answers with an error status, so core can tell "the credentials were
 * refused" from "the request was malformed" without reading the message.
 */
export class UpstreamError extends Error {
  override readonly name = "UpstreamError";

  constructor(
    /** The service that answered, such as `GitHub`. */
    readonly service: string,
    /** The HTTP status it answered with. */
    readonly status: number,
    /** The service's own message, safe to show: it never holds a header or a token. */
    readonly detail: string,
    path: string,
  ) {
    super(`${service} ${String(status)} on ${path}: ${detail}`);
  }
}

/** The public form of a store failure, thrown by everything in {@link CommentStore}. */
export class MapleStoreError extends Error {
  override readonly name = "MapleStoreError";

  /** Set when the backend itself refused the call, so a caller can tell it from a bad argument. */
  readonly upstream: UpstreamError | undefined;

  constructor(
    /** Whether another attempt could succeed. */
    readonly reason: "rejected" | "unavailable",
    readonly connector: string,
    readonly operation: string,
    override readonly cause: unknown,
  ) {
    super(`Store "${connector}" failed during ${operation} (${reason}).`);
    this.upstream = cause instanceof UpstreamError ? cause : undefined;
  }
}
