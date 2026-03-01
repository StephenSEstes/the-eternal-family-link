import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/google/sheets";
import { getRequestTenantContext } from "@/lib/family-group/context";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";

class StepFailure extends Error {
  constructor(
    public readonly step: string,
    message: string,
    public readonly status: number,
    public readonly durationMs: number,
  ) {
    super(message);
  }
}

export async function GET() {
  const routeStart = Date.now();
  let currentStep = "session";
  const requestId = createRequestId();
  let tenantKey = "";
  let userEmailMasked = "";

  const logStart = (step: string) => {
    logRoute("api/people", { requestId, step, status: "start", tenantKey, userEmailMasked });
  };
  const logOk = (step: string, durationMs: number) => {
    logRoute("api/people", { requestId, step, status: "ok", durationMs, tenantKey, userEmailMasked });
  };
  const logError = (step: string, durationMs: number, message: string, errorCode = "internal_error") => {
    logRoute("api/people", {
      requestId,
      step,
      status: "error",
      durationMs,
      message,
      errorCode,
      tenantKey,
      userEmailMasked,
    });
  };

  const runStep = async <T>(
    step: string,
    timeoutMs: number,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    currentStep = step;
    const stepStart = Date.now();
    logStart(step);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(`timeout:${step}`), timeoutMs);

    try {
      const result = await fn(controller.signal);
      const durationMs = Date.now() - stepStart;
      logOk(step, durationMs);
      return result;
    } catch (error) {
      const durationMs = Date.now() - stepStart;
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = controller.signal.aborted;
      const finalMessage = timedOut ? `Timed out after ${timeoutMs}ms` : message;
      const finalStatus = timedOut ? 504 : 500;
      logError(step, durationMs, finalMessage);
      throw new StepFailure(step, finalMessage, finalStatus, durationMs);
    } finally {
      clearTimeout(timer);
    }
  };

  const handler = async () => {
    const session = await runStep("session", 1800, async () => getAppSession());
    if (!session?.user?.email) {
      const durationMs = Date.now() - routeStart;
      logRoute("api/people", {
        requestId,
        status: "error",
        durationMs,
        message: "unauthorized",
        errorCode: "unauthorized",
      });
      return NextResponse.json({ error: "unauthorized", requestId }, { status: 401 });
    }
    userEmailMasked = maskEmail(session.user.email);

    const tenant = await runStep("tenant resolution", 300, async () => {
      return getRequestTenantContext(session);
    });
    tenantKey = tenant.tenantKey;
    const people = await runStep("fetch", 6500, async () => getPeople(tenant.tenantKey));

    const durationMs = Date.now() - routeStart;
    logRoute("api/people", {
      requestId,
      status: "ok",
      durationMs,
      tenantKey,
      userEmailMasked,
      message: `count=${people.length}`,
    });
    return NextResponse.json({ people, requestId });
  };

  const overallTimeoutMs = 9800;
  let overallTimer: ReturnType<typeof setTimeout> | null = null;
  const overallTimeout = new Promise<NextResponse>((resolve) => {
    overallTimer = setTimeout(() => {
      const durationMs = Date.now() - routeStart;
      logError(currentStep, durationMs, "Route exceeded 10s budget", "route_timeout");
      resolve(
        NextResponse.json(
          {
            error: "people_fetch_failed",
            step: currentStep,
            errorCode: "route_timeout",
            requestId,
            message: "Route exceeded 10s timeout budget",
            durationMs,
          },
          { status: 504 },
        ),
      );
    }, overallTimeoutMs);
  });

  try {
    return await Promise.race([handler(), overallTimeout]);
  } catch (error) {
    if (error instanceof StepFailure) {
      const durationMs = Date.now() - routeStart;
      const classified = classifyOperationalError(error);
      logError(error.step, durationMs, error.message, classified.errorCode);
      return NextResponse.json(
        {
          error: "people_fetch_failed",
          step: error.step,
          errorCode: classified.errorCode,
          requestId,
          message: error.message,
          durationMs,
        },
        { status: error.status },
      );
    }

    const durationMs = Date.now() - routeStart;
    const classified = classifyOperationalError(error);
    logError(currentStep, durationMs, classified.message, classified.errorCode);
    return NextResponse.json(
      {
        error: "people_fetch_failed",
        step: currentStep,
        errorCode: classified.errorCode,
        requestId,
        message: classified.message,
        durationMs,
      },
      { status: classified.status },
    );
  } finally {
    if (overallTimer) {
      clearTimeout(overallTimer);
    }
  }
}

