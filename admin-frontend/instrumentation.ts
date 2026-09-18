import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Only report from production — outside it Sentry is never initialised, which
  // makes every capture* call a no-op.
  if (process.env.NODE_ENV !== "production") return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
