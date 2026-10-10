"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Search, MapPin, LoaderCircle, ArrowUpRight } from "lucide-react";
import { locationLabel, type Location, type LocationsResponse } from "@/domain/locations";
import { addLocation } from "@/features/locations/store";
import { readApiJson } from "@/lib/read-api-json";

export function LocationSearch({ full, inputRef }: { full: boolean; inputRef?: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const localInput = useRef<HTMLInputElement>(null);
  const searchArea = useRef<HTMLDivElement>(null);
  const input = inputRef ?? localInput;
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchArea.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/locations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await readApiJson<LocationsResponse & { error?: { message?: string } }>(response, "Place search is temporarily unavailable. Please try again.");
        if (!response.ok) throw new Error(data.error?.message ?? "Place search is unavailable. Please try again.");
        if (controller.signal.aborted) return;
        setResults(data.locations);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "Place search is unavailable.");
        setStatus("error");
      }
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query]);

  function change(value: string) {
    setQuery(value); setResults([]); setMessage(""); setActive(-1); setOpen(true);
    setStatus(value.trim().length >= 2 ? "searching" : "idle");
  }
  function select(location: Location) {
    const error = addLocation(location);
    if (error) { setMessage(error); return; }
    change(""); setOpen(false); input.current?.focus();
  }

  return <div className="search-area" ref={searchArea} onBlur={event => {
    // iOS WebKit can report null relatedTarget for a tap on a non-focusable option.
    // Outside pointer events close the list; keeping it open here lets the click select.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={`${id}-input`} className="eyebrow">Find your next place</label>
    <div className="search-field">
      <Search size={19} aria-hidden="true" />
      <input ref={input} id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open && query.trim().length >= 2} aria-controls={`${id}-results`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} autoComplete="off" placeholder={full ? "Four places selected. Remove one to add another." : "Search a city or town"} value={query} maxLength={100} disabled={full} onChange={event => change(event.target.value)} onFocus={() => setOpen(true)} onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
        if (event.key === "ArrowDown" && results.length > 0) { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, results.length - 1)); }
        if (event.key === "ArrowUp" && results.length > 0) { event.preventDefault(); setOpen(true); setActive(index => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && active >= 0 && results[active]) { event.preventDefault(); select(results[active]); }
      }} />
      {status === "searching" ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <span className="search-hint">Anywhere</span>}
    </div>
    {open && query.trim().length >= 2 && <div className="search-results">
      <ul id={`${id}-results`} role="listbox" aria-label="Matching places">
        {results.map((place, index) => <li key={place.id} id={`${id}-option-${index}`} role="option" aria-selected={index === active} onClick={() => select(place)}>
          <MapPin size={17} aria-hidden="true" /><span><strong>{place.name}</strong><small>{locationLabel(place)}</small></span><ArrowUpRight size={17} aria-hidden="true" />
        </li>)}
      </ul>
      {status === "searching" && <p>Finding places…</p>}
      {status === "ready" && results.length === 0 && <p>No places found. Try another name or spelling.</p>}
      {message && <p role="alert">{message}</p>}
    </div>}
    <span className="sr-only" role="status">{status === "ready" ? `${results.length} places found.` : status === "searching" ? "Searching for places." : ""}</span>
    {message && !open && <p role="alert" className="notice">{message}</p>}
  </div>;
}
