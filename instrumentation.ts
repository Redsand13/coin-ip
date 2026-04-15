/**
 * Next.js Instrumentation — runs once when the server starts.
 *
 * Delegates all Node.js-only scanner logic to instrumentation.node.ts
 * so the Edge runtime bundler never sees Node.js-only imports.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
