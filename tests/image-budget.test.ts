import { describe, expect, it } from "vitest";
import { createImageRequestGuard } from "../src/server/operations/image-budget";

const request = new Request("http://127.0.0.1/api/image", { method: "POST" });

describe("image request admission", () => {
  it("lets local image jobs bypass billing cooldowns and daily quotas", () => {
    const begin = createImageRequestGuard();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const release = begin(request, 1_000 + attempt, { billable: false });
      release();
    }

    const hostedRelease = begin(request, 2_000);
    hostedRelease();
    expect(() => begin(request, 2_001)).toThrowError(expect.objectContaining({ code: "IMAGE_RATE_LIMIT" }));
  });

  it("still permits only one local image generation at a time", () => {
    const begin = createImageRequestGuard();
    const release = begin(request, 1_000, { billable: false });

    expect(() => begin(request, 1_001, { billable: false }))
      .toThrowError(expect.objectContaining({ code: "IMAGE_BUSY" }));

    release();
    const retry = begin(request, 1_001, { billable: false });
    expect(retry).toBeTypeOf("function");
    retry();
  });
});
