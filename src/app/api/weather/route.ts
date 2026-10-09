import { locationIdQuerySchema } from "../../../domain/locations";
import { errorResponse, invalidInput } from "../../../server/weather/errors";
import { getWeather } from "../../../server/weather/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const values = new URL(request.url).searchParams.getAll("locationId");
    const id = values.length === 1 ? locationIdQuerySchema.safeParse(values[0]) : null;
    if (!id?.success) throw invalidInput("Choose a valid location from search results.");
    const body = await getWeather(id.data);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
