import WeatherDashboard from "@/components/WeatherDashboard";

export const dynamic = "force-dynamic";

export default function Page() {
  return <WeatherDashboard imageGenerationEnabled={process.env.IMAGE_GENERATION_ENABLED === "true"} />;
}
