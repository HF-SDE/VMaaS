import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

import { config } from "./config";

Sentry.init({
  dsn: config.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Set sampling rate for profiling - this is evaluated only once per SDK.init call
  profileSessionSampleRate: 1.0,
  // Trace lifecycle automatically enables profiling during active traces
  profileLifecycle: "trace",
});
