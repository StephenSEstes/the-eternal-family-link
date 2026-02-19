import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/google/sheets";
import { getRequestTenantContext } from "@/lib/tenant/context";

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

  const logStart = (step: string) => {
    console.log(`[api/people] step=${step} status=start`);
  };
  const logOk = (step: string, durationMs: number) => {
    console.log(`[api/people] step=${step} status=ok durationMs=${durationMs}`);
  };
  const logError = (step: string, durationMs: number, message: string) => {
    console.error(`[api/people] step=${step} status=error durationMs=${durationMs} message=${message}`);
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
      console.log(`[api/people] status=unauthorized durationMs=${durationMs}`);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const tenant = await runStep("tenant resolution", 300, async () => {
      return getRequestTenantContext(session);
    });
    const people = await runStep("fetch", 6500, async () => getPeople(tenant.tenantKey));

    const durationMs = Date.now() - routeStart;
    console.log(
      `[api/people] status=ok durationMs=${durationMs} count=${people.length} tenant=${tenant.tenantKey}`,
    );
    return NextResponse.json({ people });
  };

  const overallTimeoutMs = 9800;
  let overallTimer: ReturnType<typeof setTimeout> | null = null;
  const overallTimeout = new Promise<NextResponse>((resolve) => {
    overallTimer = setTimeout(() => {
      const durationMs = Date.now() - routeStart;
      logError(currentStep, durationMs, "Route exceeded 10s budget");
      resolve(
        NextResponse.json(
          {
            error: "people_fetch_failed",
            step: currentStep,
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
      return NextResponse.json(
        {
          error: "people_fetch_failed",
          step: error.step,
          message: error.message,
          durationMs,
        },
        { status: error.status },
      );
    }

    const durationMs = Date.now() - routeStart;
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(`[api/people] step=${currentStep} status=error durationMs=${durationMs} message=${message}`);
    return NextResponse.json(
      {
        error: "people_fetch_failed",
        step: currentStep,
        message,
        durationMs,
      },
      { status: 500 },
    );
  } finally {
    if (overallTimer) {
      clearTimeout(overallTimer);
    }
  }
}
