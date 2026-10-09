"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun, Moon, Wind, ArrowUp, ArrowDown, X, RefreshCw, Clock, Radio } from "lucide-react";
import type { Location } from "@/domain/locations";
import type { WeatherResponse, WeatherSnapshot } from "@/domain/weather";
import { SpotlightCard } from "./reactbits/SpotlightCard";

type Props = { location: Location; index: number; focused: boolean; onRemove: (id: number) => void; onFocus: (id: number) => void; onWeather: (id: number, weather: WeatherSnapshot | null) => void };
const temperature = (value: number) => Math.round(value);

export function WeatherCard({ location, index, focused, onRemove, onFocus, onWeather }: Props) {
  const [response, setResponse] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetch(`/api/weather?locationId=${location.id}`, { signal: controller.signal });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error?.message ?? "Weather is unavailable. Please try again.");
        if (controller.signal.aborted) return;
        const weather = data as WeatherResponse;
        setResponse(weather); setError(null); onWeather(location.id, weather.weather);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Weather is unavailable."); }
    }
    void load();
    const refresh = window.setInterval(() => { void load(); }, 5 * 60_000);
    return () => { controller.abort(); window.clearInterval(refresh); onWeather(location.id, null); };
  }, [location.id, retry, onWeather]);

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("en-GB", { timeZone: location.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()));
    const timeout = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 15_000);
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [location.timezone]);

  const weather = response?.weather;
  const Icon = weather?.category === "rain" ? CloudRain : weather?.category === "snow" ? CloudSnow : weather?.category === "thunderstorm" ? CloudLightning : weather?.category === "fog" ? CloudFog : weather?.category === "cloudy" ? Cloud : weather?.isDay === false ? Moon : Sun;
  return <article aria-label={`Weather for ${location.name}`} className={`weather-card ${focused ? "weather-card-focused" : ""}`}>
    <SpotlightCard>
      <div className="card-top"><span className="card-number">0{index + 1}</span><button className="icon-button" aria-label={`Remove ${location.name}`} onClick={() => onRemove(location.id)}><X size={16} /></button></div>
      <div className="place-heading"><div><h2>{location.name}</h2><p>{[location.admin1, location.country].filter(Boolean).join(", ")}</p></div><Icon className={`weather-icon ${weather?.category ?? "loading"}`} size={40} strokeWidth={1.25} aria-hidden="true" /></div>
      {weather ? <>
        <div className="temperature">{temperature(weather.temperatureC)}<span>°C</span></div>
        <p className="condition">{weather.condition}</p>
        <div className="weather-details"><span><ArrowUp size={13} aria-hidden="true" />{temperature(weather.highC)}°C <small>high</small></span><span><ArrowDown size={13} aria-hidden="true" />{temperature(weather.lowC)}°C <small>low</small></span></div>
        <div className="wind"><Wind size={15} aria-hidden="true" />{Math.round(weather.windKmh)} km/h <span>wind</span></div>
      </> : error ? <div className="card-error" role="alert"><Cloud size={32} strokeWidth={1} /><p>{error}</p><button className="text-button" onClick={() => { setError(null); setRetry(value => value + 1); }}><RefreshCw size={14} />Retry weather</button></div> : <div className="weather-loading" aria-label="Loading weather"><span /><span /><p>Reading the sky…</p></div>}
      {weather && error && <p className="card-warning" role="alert">Refresh failed. Displaying the last received weather. <button onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
      {response?.warning && <p className="card-warning" role="status">{response.warning}</p>}
      <div className="card-bottom"><span><Clock size={12} aria-hidden="true" /><time suppressHydrationWarning>{clock || "Local time"}</time></span><button className="focus-button" aria-label={`${focused ? "In focus" : "Focus sky"} for ${location.name}`} aria-pressed={focused} onClick={() => onFocus(location.id)}><Radio size={12} aria-hidden="true" />{focused ? "In focus" : "Focus sky"}</button></div>
      {weather && <p className="observation">Observed {new Intl.DateTimeFormat("en-GB", { timeZone: location.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(weather.observedAt))} local</p>}
    </SpotlightCard>
  </article>;
}
