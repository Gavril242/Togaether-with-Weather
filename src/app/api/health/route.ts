export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness only. External provider availability must not restart the app. */
export function GET(): Response {
  return Response.json({ status: "ok", service: "togaether-weather" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
