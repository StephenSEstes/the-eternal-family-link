/**
 * Suppress known dependency warning:
 * next-auth -> openid-client@5 emits DEP0169 via legacy url.parse().
 * We filter only that warning code to keep logs actionable.
 */
export async function register() {
  // Middleware/edge runtimes do not guarantee a Node.js warning API.
  if (typeof process === "undefined" || typeof process.emitWarning !== "function") return;

  const globalMarker = "__eflDep0169FilterInstalled";
  const globalState = globalThis as typeof globalThis & Record<string, boolean>;
  if (globalState[globalMarker]) return;
  globalState[globalMarker] = true;

  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const codeFromWarning =
      typeof warning === "object" &&
      warning !== null &&
      "code" in warning &&
      typeof (warning as { code?: unknown }).code === "string"
        ? (warning as { code: string }).code
        : undefined;

    const optionsArg = args.find((arg) => typeof arg === "object" && arg !== null) as
      | { code?: unknown }
      | undefined;
    const codeFromArgs = typeof optionsArg?.code === "string" ? optionsArg.code : undefined;

    const warningText =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : "";

    const warningCode = codeFromWarning ?? codeFromArgs;
    const isUrlParseDeprecation =
      warningCode === "DEP0169" || warningText.includes("url.parse()");

    if (isUrlParseDeprecation) return;
    return originalEmitWarning(warning as never, ...(args as never[]));
  }) as typeof process.emitWarning;
}
