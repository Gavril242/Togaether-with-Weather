import { describe, expect, it } from "vitest";
import { decodePlaceCookie, encodePlaceCookie, PLACES_COOKIE, placeCookieHeader, placeIdsQuerySchema, readPlaceCookie } from "../src/features/locations/cookie";

describe("location preference cookie", () => {
  it("stores only a version and up to four distinct canonical IDs", () => {
    expect(encodePlaceCookie([2643743, 1850147, 3413829, 4250542])).toBe("1.2643743.1850147.3413829.4250542");
    expect(decodePlaceCookie("1.2643743.1850147")).toEqual([2643743, 1850147]);
    expect(decodePlaceCookie("1")).toEqual([]);
    expect(encodePlaceCookie([2147483647, 2147483646, 2147483645, 2147483644]).length).toBe(45);
  });

  it.each(["2.123", "1.0", "1.-1", "1.001", "1.1e5", "1.123.123", "1.1.2.3.4.5", "1.2147483648", "1.123; Domain=evil.example", `1.${"9".repeat(200)}`])("rejects malformed or oversized cookie values: %s", (value) => {
    expect(decodePlaceCookie(value)).toBeNull();
  });

  it("distinguishes missing, invalid and empty selections", () => {
    expect(readPlaceCookie("other=value")).toEqual({ present: false, ids: null });
    expect(readPlaceCookie(`${PLACES_COOKIE}=1; other=value`)).toEqual({ present: true, ids: [] });
    expect(readPlaceCookie(`${PLACES_COOKIE}=broken`)).toEqual({ present: true, ids: null });
    expect(readPlaceCookie(`${PLACES_COOKIE}=1.123; ${PLACES_COOKIE}=1.456`)).toEqual({ present: true, ids: null });
  });

  it("uses host scope, a bounded lifetime and HTTPS security attributes", () => {
    expect(placeCookieHeader([2643743], true)).toBe(`${PLACES_COOKIE}=1.2643743; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(placeCookieHeader([2643743], false)).not.toContain("Secure");
    expect(placeCookieHeader([], true)).not.toContain("Domain=");
  });

  it("rejects duplicate, empty or extra IDs before canonical lookup", () => {
    expect(placeIdsQuerySchema.safeParse("2643743,1850147").success).toBe(true);
    for (const query of ["", "1,1", "1,2,3,4,5", "https://localhost", "2643743.1850147", "0", "001", "2147483648"]) {
      expect(placeIdsQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
