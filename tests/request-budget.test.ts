import { describe, expect, it } from "vitest";
import { createRequestBudget, requestClientKey } from "../src/server/operations/budget";

describe("origin request admission", () => {
  it("bounds a client burst and recovers as tokens refill", () => {
    let time = 0;
    const admit = createRequestBudget(() => time);
    for (let i = 0; i < 30; i++) admit("visitor");
    expect(() => admit("visitor")).toThrow("Too many weather requests");
    admit("another visitor");
    time += 1_000;
    admit("visitor");
    expect(() => admit("visitor")).toThrow();
  });

  it("bounds the origin even when client addresses change", () => {
    const admit = createRequestBudget(() => 0);
    for (let i = 0; i < 120; i++) admit(`client-${i}`);
    expect(() => admit("different-address")).toThrow();
  });

  it("does not replenish tokens if the wall clock moves backwards", () => {
    let time = 1_000;
    const admit = createRequestBudget(() => time);
    for (let i = 0; i < 30; i++) admit("visitor");
    time = 0;
    expect(() => admit("visitor")).toThrow();
  });

  it("only accepts a valid Cloudflare address when the origin explicitly trusts its connector", () => {
    const request = new Request("http://localhost", { headers: { "CF-Connecting-IP": "2001:db8::1", "X-Forwarded-For": "1.2.3.4" } });
    expect(requestClientKey(request)).toBe("local");
    expect(requestClientKey(request, true)).toBe("2001:db8::1");
    expect(requestClientKey(new Request("http://localhost", { headers: { "CF-Connecting-IP": "spoofed" } }), true)).toBe("local");
  });
});
