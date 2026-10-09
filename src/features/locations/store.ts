import { z } from "zod";
import { locationSchema, type Location } from "@/domain/locations";

export const STORAGE_KEY = "fourcast.locations.v1";
const storedSchema = z.object({ version: z.literal(1), locations: z.array(locationSchema).max(4) });
export type Selection = { locations: Location[]; storageError: string | null };
export const EMPTY_SELECTION: Selection = { locations: [], storageError: null };

export function restoreSelection(value: string | null): Selection {
  if (!value) return EMPTY_SELECTION;
  try {
    const data = storedSchema.parse(JSON.parse(value));
    if (new Set(data.locations.map(place => place.id)).size !== data.locations.length) throw new Error("Duplicates");
    return { locations: data.locations, storageError: null };
  } catch {
    return { locations: [], storageError: "Saved places could not be restored. Please choose them again." };
  }
}

let current = EMPTY_SELECTION;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function getSelection(): Selection {
  if (typeof window === "undefined") return EMPTY_SELECTION;
  if (!loaded) {
    loaded = true;
    try { current = restoreSelection(window.localStorage.getItem(STORAGE_KEY)); }
    catch { current = { locations: [], storageError: "Your browser cannot save places. They will remain available in this tab." }; }
  }
  return current;
}

export function subscribeSelection(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      try { current = restoreSelection(window.localStorage.getItem(STORAGE_KEY)); }
      catch { current = { ...current, storageError: "Saved places cannot be read in this browser." }; }
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function save(locations: Location[]) {
  current = { locations, storageError: null };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, locations })); }
  catch { current.storageError = "Your browser could not save this change. Your places are available in this tab."; }
  emit();
}

export function addLocation(location: Location): string | null {
  const places = getSelection().locations;
  if (places.some(place => place.id === location.id)) return "This place is already on your dashboard.";
  if (places.length === 4) return "Remove a place before adding another.";
  save([...places, locationSchema.parse(location)]);
  return null;
}

export function removeLocation(id: number) { save(getSelection().locations.filter(place => place.id !== id)); }
