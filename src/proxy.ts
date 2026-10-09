import { NextResponse, type NextRequest } from "next/server";

function canonicalOrigin(): URL | null {
  if (process.env.TRUST_CLOUDFLARE_PROXY !== "true") return null;
  try {
    const origin = new URL(process.env.APP_PUBLIC_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return null;
    return origin;
  } catch {
    return null;
  }
}

/** Trust Cloudflare's edge scheme only at the loopback-only configured origin. */
export function proxy(request: NextRequest) {
  const origin = canonicalOrigin();
  if (!origin) return NextResponse.next();
  let edgeScheme: unknown;
  try {
    edgeScheme = JSON.parse(request.headers.get("cf-visitor") ?? "null")?.scheme;
  } catch {
    return NextResponse.next();
  }
  if (edgeScheme !== "http") return NextResponse.next();
  const destination = new URL(origin);
  destination.pathname = request.nextUrl.pathname;
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

export const config = { matcher: "/:path*" };
