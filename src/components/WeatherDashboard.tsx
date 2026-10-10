"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useRef, useState, useSyncExternalStore, ViewTransition } from "react";
import { ArrowUpRight, Plus, Sparkles, VolumeX, Waves, Aperture, Globe2, CloudSun } from "lucide-react";
import { EMPTY_SELECTION, getSelection, subscribeSelection, removeLocation } from "@/features/locations/store";
import type { WeatherSnapshot } from "@/domain/weather";
import type { AtmosphereCondition } from "./atmosphere/Atmosphere";
import { LocationSearch } from "./LocationSearch";
import { WeatherCard } from "./WeatherCard";
import Image from "next/image";
import { readApiJson } from "@/lib/read-api-json";

type WeatherImageResponse = {
  image: { data: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number; model: string };
  prompt: { version: string; text: string; locationIds: number[]; observedAt: string[] };
};

const Atmosphere = dynamic(() => import("./atmosphere/Atmosphere"), { ssr: false });

export default function WeatherDashboard() {
  const selection = useSyncExternalStore(subscribeSelection, getSelection, () => EMPTY_SELECTION);
  const { locations, storageError } = selection;
  const [weather, setWeather] = useState<Record<number, WeatherSnapshot>>({});
  const [focusedId, setRawFocusedId] = useState<number | null>(null);
  const setFocusedId = (id: number) => startTransition(() => setRawFocusedId(id));
  const [ambient, setAmbient] = useState(true);
  const [image, setImage] = useState<WeatherImageResponse | null>(null);
  const [imageMessage, setImageMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const handleRemove = (id: number) => {
    removeLocation(id);
    if (focusedId === id) setRawFocusedId(null);
    requestAnimationFrame(() => searchInput.current?.focus());
  };
  const selectedFocus = locations.find(place => place.id === focusedId) ?? locations[0];
  const focus = selectedFocus ? weather[selectedFocus.id] : undefined;
  const onWeather = useCallback((id: number, snapshot: WeatherSnapshot | null) => setWeather(previous => {
    if (snapshot) return { ...previous, [id]: snapshot };
    if (!(id in previous)) return previous;
    const next = { ...previous };
    delete next[id];
    return next;
  }), []);
  const condition: AtmosphereCondition = focus?.category === "thunderstorm" ? "storm" : focus?.category ?? "cloudy";
  const complete = locations.length === 4 && locations.every(place => weather[place.id]);
  const currentImage = image && image.prompt.locationIds.length === locations.length
    && image.prompt.locationIds.every((id, index) => id === locations[index]?.id) ? image : null;

  const generateImage = async () => {
    if (!complete || generating) return;
    setGenerating(true); setImageMessage(""); setImage(null);
    try {
      const response = await fetch("/api/image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationIds: locations.map(location => location.id) }),
      });
      const data = await readApiJson<WeatherImageResponse & { error?: { message?: string } }>(response,
        "The image service is temporarily unavailable. Please try again.");
      if (!response.ok) throw new Error(data.error?.message ?? "The image could not be generated. Please try again.");
      setImage(data);
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : "The image could not be generated.");
    } finally { setGenerating(false); }
  };

  return <>
    {ambient ? <Atmosphere condition={condition} timezone={selectedFocus?.timezone ?? "UTC"} intensity={0.4} /> : <div className="static-sky" aria-hidden="true" />}
    <div className="page-content">
      <header className="site-header"><a className="brand" href="/" aria-label="Fourcast home"><Aperture size={27} strokeWidth={1.3} /><span>fourcast<span className="brand-dot">.</span></span></a><nav aria-label="Dashboard controls"><span className="live-label"><i />Live weather</span><button className="ambient-button" aria-label={`Atmosphere ${ambient ? "on" : "off"}. Ambient motion`} aria-pressed={ambient} onClick={() => setAmbient(value => !value)}>{ambient ? <Waves size={16} /> : <VolumeX size={16} />}<span>Atmosphere {ambient ? "on" : "off"}</span></button></nav></header>
      <main id="main">
        <section className="hero"><div className="hero-copy"><p className="eyebrow"><Globe2 size={12} aria-hidden="true" />A small window into the world</p><h1>Four places.<br /><span>One atmosphere.</span></h1><p className="hero-description">The weather where you are. And where you wish you were. <br className="desktop-break" />Choose four places and watch their skies come together.</p></div><div className="hero-note"><span className="note-line" /><p>{selectedFocus ? <>Your atmosphere follows<br /><strong>{selectedFocus.name}</strong><br /><small>{focus?.condition ?? "Connecting to its sky"}</small></> : <>A different sky.<br />A different point of view.<br /><small>Start with a place you love.</small></>}</p></div></section>
        <div className="locations-toolbar"><LocationSearch full={locations.length === 4} inputRef={searchInput} /><div className="location-progress"><div>{Array.from({ length: 4 }, (_, index) => <span key={index} className={index < locations.length ? "filled" : ""} />)}</div><p aria-live="polite">{locations.length} of 4 places</p></div></div>
        {storageError && <p className="notice" role="alert">{storageError}</p>}
        <section className="weather-grid" aria-label="Your places"><ViewTransition enter="card-enter" exit="card-exit">{locations.map((location, index) => <WeatherCard key={location.id} location={location} index={index} focused={location.id === selectedFocus?.id} onRemove={handleRemove} onFocus={setFocusedId} onWeather={onWeather} />)}{Array.from({ length: 4 - locations.length }, (_, index) => <div className="empty-card" key={`empty-${index}`}><span className="card-number">0{locations.length + index + 1}</span><div className="empty-card-center"><span className="plus-ring"><Plus size={22} strokeWidth={1} /></span><p>{locations.length === 0 && index === 0 ? "Your first place" : "A new perspective"}</p><small>Search above to add a place</small></div><span className="empty-card-bottom">A sky waiting to be discovered<ArrowUpRight size={14} /></span></div>)}</ViewTransition></section>
        <section className="image-studio" aria-labelledby="studio-heading"><div className="studio-copy"><p className="eyebrow"><Sparkles size={13} />The weather, imagined</p><h2 id="studio-heading">Every sky tells a story.</h2><p>One original image, composed from the weather <br className="desktop-break" />in all four places. The exact prompt stays beside it.</p><button className="generate-button" disabled={!complete || generating} aria-label="Generate weather image" onClick={() => void generateImage()}><Sparkles size={17} />{generating ? "Creating image…" : "Generate image"}<ArrowUpRight size={17} /></button><p className="studio-status" role={imageMessage ? "alert" : undefined}>{imageMessage || (generating ? "One request is in progress. It will not be retried automatically." : complete ? currentImage ? "Your image and the exact prompt are ready below." : "Ready when you are. Image generation uses the server Gemini key." : "Add four places and wait for their weather to load.")}</p></div><div className="studio-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-mark"><CloudSun size={56} strokeWidth={0.8} /><span>FOUR SKIES. ONE FRAME.</span></div><div className="art-coordinates">01 / 02 / 03 / 04</div></div></section>
        {currentImage && <section className="image-output" aria-label="Generated weather image and prompt">
          <figure><Image src={`data:${currentImage.image.mimeType};base64,${currentImage.image.data}`} alt="AI-generated four-panel interpretation of the weather in your selected places" width={currentImage.image.width} height={currentImage.image.height} unoptimized /><figcaption>Created with {currentImage.image.model}. Readings remain sourced from Open Meteo.</figcaption></figure>
          <details className="image-prompt" open><summary>Exact weather prompt</summary><pre>{currentImage.prompt.text}</pre></details>
        </section>}
      </main>
      <footer><span>Made for the moments between places.</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open Meteo<ArrowUpRight size={12} /></a><span>°C / km/h</span></footer>
    </div>
  </>;
}
