import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Location } from "../src/domain/locations";

const london: Location = { id: 2643743, name: "London", latitude: 51.50853, longitude: -0.12574, timezone: "Europe/London", country: "United Kingdom", countryCode: "GB", admin1: "England" };
const tokyo: Location = { id: 1850147, name: "Tokyo", latitude: 35.6895, longitude: 139.69171, timezone: "Asia/Tokyo", country: "Japan", countryCode: "JP", admin1: "Tokyo" };
const key = "fourcast.locations.v1";
let values: Map<string, string>;
let jar: string;
let lastCookie: string;
let cookieWritable: boolean;
let localWritable: boolean;
let fetcher: ReturnType<typeof vi.fn>;
let store: typeof import("../src/features/locations/store");

beforeEach(async () => {
  vi.resetModules();
  values = new Map(); jar = ""; lastCookie = ""; cookieWritable = true; localWritable = true;
  fetcher = vi.fn();
  const documentStub = Object.defineProperty({}, "cookie", {
    get: () => jar,
    set: (value: string) => { lastCookie = value; if (cookieWritable) jar = value.split(";")[0]; },
  });
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", {
    location: { protocol: "https:" },
    localStorage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { if (!localWritable) throw new Error("Storage unavailable"); values.set(name, value); },
    },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("fetch", fetcher);
  store = await import("../src/features/locations/store");
});

afterEach(() => vi.unstubAllGlobals());

describe("selection cookie persistence", () => {
  it("rejects oversized or duplicated old local preferences before migration", () => {
    expect(store.restoreSelection(" ".repeat(20_000)).storageError).toContain("could not be restored");
    expect(store.restoreSelection(JSON.stringify({ version: 1, locations: [london, london] })).locations).toEqual([]);
  });

  it("migrates validated legacy localStorage without fetching saved weather", () => {
    values.set(key, JSON.stringify({ version: 1, locations: [london, tokyo] }));
    expect(store.getSelection().locations).toEqual([london, tokyo]);
    store.subscribeSelection(() => {});
    expect(jar).toBe("fourcast_places_v1=1.2643743.1850147");
    expect(lastCookie).toContain("SameSite=Lax; Secure");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses cookie ID order and ignores stale localStorage places", () => {
    values.set(key, JSON.stringify({ version: 1, locations: [london, tokyo] }));
    jar = "fourcast_places_v1=1.1850147";
    expect(store.getSelection().locations).toEqual([tokyo]);
    store.subscribeSelection(() => {});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("restores canonical places from cookies when local metadata is missing", async () => {
    jar = "fourcast_places_v1=1.2643743.1850147";
    fetcher.mockResolvedValue(Response.json({ locations: [london, tokyo], unavailableIds: [] }));
    expect(store.getSelection().locations).toEqual([]);
    const listener = vi.fn();
    store.subscribeSelection(listener);
    await vi.waitFor(() => expect(store.getSelection().locations).toEqual([london, tokyo]));
    expect(fetcher).toHaveBeenCalledWith("/api/locations/restore?ids=2643743,1850147", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(listener).toHaveBeenCalled();
    expect(values.get(key)).toContain("London");
  });

  it("cancels restoration so a late response cannot overwrite a user's edit", async () => {
    jar = "fourcast_places_v1=1.2643743";
    let release!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    store.subscribeSelection(() => {});
    expect(store.addLocation(tokyo)).toBeNull();
    release(Response.json({ locations: [london], unavailableIds: [] }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(store.getSelection().locations).toEqual([tokyo]);
    expect(jar).toBe("fourcast_places_v1=1.1850147");
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not silently drop saved IDs when one canonical lookup fails", async () => {
    jar = "fourcast_places_v1=1.2643743.1850147";
    fetcher.mockResolvedValue(Response.json({ locations: [tokyo], unavailableIds: [london.id] }));
    store.subscribeSelection(() => {});
    await vi.waitFor(() => expect(store.getSelection().storageError).toContain("Some saved places"));
    expect(store.getSelection().locations).toEqual([tokyo]);
    expect(jar).toBe("fourcast_places_v1=1.2643743.1850147");
  });

  it("rejects unrelated IDs returned by a malformed restoration endpoint", async () => {
    jar = "fourcast_places_v1=1.2643743";
    fetcher.mockResolvedValue(Response.json({ locations: [tokyo], unavailableIds: [] }));
    store.subscribeSelection(() => {});
    await vi.waitFor(() => expect(store.getSelection().storageError).toContain("could not be restored"));
    expect(store.getSelection().locations).toEqual([]);
  });

  it("continues saving preferences when either persistence mechanism is blocked", () => {
    localWritable = false;
    store.addLocation(london);
    expect(jar).toBe("fourcast_places_v1=1.2643743");
    expect(store.getSelection().storageError).toBeNull();
    localWritable = true; cookieWritable = false;
    store.addLocation(tokyo);
    expect(values.get(key)).toContain("Tokyo");
    expect(store.getSelection().storageError).toBeNull();
  });

  it("warns about tab-only preferences when cookies and localStorage both fail", () => {
    localWritable = false; cookieWritable = false;
    store.addLocation(london);
    expect(store.getSelection().locations).toEqual([london]);
    expect(store.getSelection().storageError).toContain("available in this tab");
  });

  it("uses newer local preferences when an existing cookie refuses updates", async () => {
    jar = "fourcast_places_v1=1.2643743";
    values.set(key, JSON.stringify({ version: 1, locations: [london], cookieSynced: true }));
    cookieWritable = false;
    store.addLocation(tokyo);
    expect(jar).toBe("fourcast_places_v1=1.2643743");
    expect(JSON.parse(values.get(key)!).cookieSynced).toBe(false);
    vi.resetModules();
    store = await import("../src/features/locations/store");
    expect(store.getSelection().locations).toEqual([london, tokyo]);
    store.subscribeSelection(() => {});
    expect(store.getSelection().storageError).toBeNull();
  });

  it("remembers an intentionally empty selection even if localStorage has old records", () => {
    values.set(key, JSON.stringify({ version: 1, locations: [london] }));
    jar = "fourcast_places_v1=1";
    expect(store.getSelection().locations).toEqual([]);
    expect(store.addLocation(tokyo)).toBeNull();
    store.removeLocation(tokyo.id);
    expect(jar).toBe("fourcast_places_v1=1");
  });

  it("keeps the server snapshot empty until browser hydration", () => {
    vi.stubGlobal("window", undefined);
    expect(store.getSelection()).toBe(store.EMPTY_SELECTION);
  });
});
