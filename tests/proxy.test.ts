import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const trust = process.env.TRUST_CLOUDFLARE_PROXY;
const publicOrigin = process.env.APP_PUBLIC_ORIGIN;
afterEach(() => {
  if (trust === undefined) delete process.env.TRUST_CLOUDFLARE_PROXY;
  else process.env.TRUST_CLOUDFLARE_PROXY = trust;
  if (publicOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
  else process.env.APP_PUBLIC_ORIGIN = publicOrigin;
});

describe("Cloudflare HTTPS redirect", () => {
  it("redirects an edge HTTP visit to the configured hostname and preserves path and query", () => {
    process.env.TRUST_CLOUDFLARE_PROXY = "true";
    process.env.APP_PUBLIC_ORIGIN = "https://fourcast.misaland.me";
    const response = proxy(new NextRequest("http://origin.local/api/locations?q=New%20York", {
      headers: { "cf-visitor": '{"scheme":"http"}' },
    }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://fourcast.misaland.me/api/locations?q=New%20York");
  });

  it("keeps protocol relative request paths on the configured hostname", () => {
    process.env.TRUST_CLOUDFLARE_PROXY = "true";
    process.env.APP_PUBLIC_ORIGIN = "https://fourcast.misaland.me";
    const response = proxy(new NextRequest("http://origin.local//attacker.invalid", {
      headers: { "cf-visitor": '{"scheme":"http"}' },
    }));
    expect(response.headers.get("location")).toBe("https://fourcast.misaland.me//attacker.invalid");
  });

  it("keeps HTTPS, local health probes and requests without Cloudflare scheme metadata on HTTP", () => {
    process.env.TRUST_CLOUDFLARE_PROXY = "true";
    process.env.APP_PUBLIC_ORIGIN = "https://fourcast.misaland.me";
    expect(proxy(new NextRequest("http://127.0.0.1:3102/api/health")).status).toBe(200);
    expect(proxy(new NextRequest("https://fourcast.misaland.me/")).status).toBe(200);
    expect(proxy(new NextRequest("http://origin.local/", { headers: { "cf-visitor": '{"scheme":"https"}' } })).status).toBe(200);
  });

  it("does not trust edge headers when disabled or redirect to an invalid configured origin", () => {
    process.env.TRUST_CLOUDFLARE_PROXY = "false";
    process.env.APP_PUBLIC_ORIGIN = "https://fourcast.misaland.me";
    expect(proxy(new NextRequest("http://origin.local/", { headers: { "cf-visitor": '{"scheme":"http"}' } })).status).toBe(200);
    process.env.TRUST_CLOUDFLARE_PROXY = "true";
    process.env.APP_PUBLIC_ORIGIN = "http://attacker.invalid";
    expect(proxy(new NextRequest("http://origin.local/", { headers: { "cf-visitor": '{"scheme":"http"}' } })).status).toBe(200);
  });
});
