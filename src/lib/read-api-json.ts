/** Read a same-origin API response without exposing HTML gateway pages as JSON parse errors. */
export async function readApiJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new Error(fallbackMessage);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}
