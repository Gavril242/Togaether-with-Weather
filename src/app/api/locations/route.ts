import { errorResponse, invalidInput } from "../../../server/weather/errors";
import { searchLocations } from "../../../server/weather/service";
import { enforceWeatherBudget } from "../../../server/operations/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const values = new URL(request.url).searchParams.getAll("q");
    if (values.length !== 1) throw invalidInput("Enter a place name to search.");
    enforceWeatherBudget(request);
    const locations = await searchLocations(values[0]);
    return Response.json({ locations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
