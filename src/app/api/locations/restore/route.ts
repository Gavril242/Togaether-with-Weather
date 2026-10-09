import { placeIdsQuerySchema } from "@/features/locations/cookie";
import { errorResponse, invalidInput } from "@/server/weather/errors";
import { resolveLocation } from "@/server/weather/service";
import { enforceWeatherBudget } from "@/server/operations/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const values = new URL(request.url).searchParams.getAll("ids");
    const ids = values.length === 1 ? placeIdsQuerySchema.safeParse(values[0]) : null;
    if (!ids?.success) throw invalidInput("Saved places must contain up to four distinct valid location IDs.");
    enforceWeatherBudget(request);
    const results = await Promise.allSettled(ids.data.map(resolveLocation));
    const locations = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const unavailableIds = ids.data.filter((_, index) => results[index].status === "rejected");
    return Response.json({ locations, unavailableIds }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
