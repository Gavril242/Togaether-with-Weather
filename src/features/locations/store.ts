import { z } from "zod";
import { locationSchema, type Location } from "@/domain/locations";
import { consentCookieHeader, expiredPreferenceCookies, hasCookieConsent, placeCookieHeader, readPlaceCookie, placeIdsSchema } from "./cookie";

export const STORAGE_KEY = "fourcast.locations.v1";
export const CONSENT_STORAGE_KEY = "fourcast.consent.v1";
export const TAB_STORAGE_KEY = "fourcast.locations.tab.v1";
export const TAB_CONSENT_KEY = "fourcast.consent.session.v1";
export type ConsentChoice = "undecided" | "allow" | "tab";
const storedSchema = z.object({ version: z.literal(1), locations: z.array(locationSchema).max(4), cookieSynced: z.boolean().optional() });
export type Selection = { locations: Location[]; storageError: string | null };
export const EMPTY_SELECTION: Selection = { locations: [], storageError: null };

export function restoreSelection(value: string | null): Selection {
  if (!value) return EMPTY_SELECTION;
  try {
    if (value.length > 16_000) throw new Error("Saved preference too large");
    const data = storedSchema.parse(JSON.parse(value));
    if (new Set(data.locations.map(place => place.id)).size !== data.locations.length) throw new Error("Duplicates");
    return { locations: data.locations, storageError: null };
  } catch {
    return { locations: [], storageError: "Saved places could not be restored. Please choose them again." };
  }
}

let current = EMPTY_SELECTION;
let consent: ConsentChoice = "undecided";
let loaded = false;
let revision = 0;
let restoration: AbortController | null = null;
let restoringIds: number[] | null = null;
let pendingIds: number[] | null = null;
let migrateCookie = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const secure = () => window.location.protocol === "https:";

function readConsent(): ConsentChoice {
  try { if (window.sessionStorage.getItem(TAB_CONSENT_KEY) === "tab") return "tab"; } catch { /* Try the persistent choices when session access is blocked. */ }
  try { if (hasCookieConsent(document.cookie)) return "allow"; } catch { /* localStorage can retain an explicitly allowed choice. */ }
  try { if (window.localStorage.getItem(CONSENT_STORAGE_KEY) === "allow") return "allow"; } catch { /* Without a readable choice, ask again. */ }
  return "undecided";
}

function writeCookieIds(ids: number[]): boolean {
  try {
    document.cookie = placeCookieHeader(ids, secure());
    return readPlaceCookie(document.cookie).ids?.join(".") === ids.join(".");
  } catch { return false; }
}

function writeLocal(locations: Location[], cookieSynced = true): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, locations, cookieSynced }));
    return true;
  } catch { return false; }
}

function writeTab(locations: Location[]): boolean {
  try {
    window.sessionStorage.setItem(TAB_CONSENT_KEY, "tab");
    window.sessionStorage.setItem(TAB_STORAGE_KEY, JSON.stringify({ version: 1, locations }));
    return true;
  } catch { return false; }
}

function persistSelection(locations: Location[]): boolean {
  if (consent === "undecided") return true;
  if (consent === "tab") return writeTab(locations);
  const cookieSaved = writeCookieIds(locations.map((place) => place.id));
  const localSaved = writeLocal(locations, cookieSaved);
  return cookieSaved || localSaved;
}

function clearPersistentPreferences(): boolean {
  let cleared = true;
  try {
    for (const header of expiredPreferenceCookies(secure())) document.cookie = header;
    if (readPlaceCookie(document.cookie).present || hasCookieConsent(document.cookie)) cleared = false;
  } catch { cleared = false; }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch { cleared = false; }
  return cleared;
}

function cancelRestoration() {
  revision += 1;
  restoration?.abort();
  restoration = null;
  restoringIds = null;
  pendingIds = null;
}

function loadBrowserSelection() {
  consent = readConsent();
  pendingIds = null;
  migrateCookie = false;
  if (consent === "tab") {
    try { current = restoreSelection(window.sessionStorage.getItem(TAB_STORAGE_KEY)); }
    catch { current = { locations: [], storageError: "Your browser cannot restore this tab's places. Choose them again." }; }
    return;
  }
  let local: Selection;
  let cookieUnsynced = false;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    local = restoreSelection(value);
    if (value && !local.storageError) cookieUnsynced = storedSchema.parse(JSON.parse(value)).cookieSynced === false;
  } catch { local = { locations: [], storageError: "Your browser cannot read saved places. Choose them again to keep them in this tab." }; }
  // Legacy preferences may be read before consent; migration never writes yet.
  if (cookieUnsynced) { current = local; migrateCookie = true; return; }
  let cookie: ReturnType<typeof readPlaceCookie>;
  try { cookie = readPlaceCookie(document.cookie); }
  catch { current = local; return; }
  if (!cookie.present || !cookie.ids) {
    current = local;
    migrateCookie = local.locations.length > 0;
    if (cookie.present && local.locations.length === 0) current = { ...local, storageError: "Saved place cookie could not be restored. Please choose your places again." };
    return;
  }
  const saved = new Map(local.locations.map((place) => [place.id, place]));
  const locations = cookie.ids.flatMap((id) => saved.has(id) ? [saved.get(id)!] : []);
  current = { locations, storageError: null };
  if (locations.length !== cookie.ids.length) pendingIds = cookie.ids;
}

const restoredSchema = z.object({ locations: z.array(locationSchema).max(4), unavailableIds: placeIdsSchema });

function startRestoration() {
  if (migrateCookie && consent === "allow") {
    if (writeCookieIds(current.locations.map((place) => place.id))) writeLocal(current.locations);
    migrateCookie = false;
  }
  const ids = pendingIds;
  if (!ids || ids.length === 0) return;
  pendingIds = null;
  const initialRevision = revision;
  const controller = new AbortController();
  restoration = controller;
  restoringIds = ids;
  void (async () => {
    try {
      const response = await fetch(`/api/locations/restore?ids=${ids.join(",")}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error("Restore failed");
      const body = restoredSchema.parse(await response.json());
      const returnedIds = [...body.locations.map((place) => place.id), ...body.unavailableIds];
      if (new Set(returnedIds).size !== returnedIds.length || returnedIds.length !== ids.length || returnedIds.some((id) => !ids.includes(id))) throw new Error("Invalid saved location response");
      if (controller.signal.aborted || revision !== initialRevision) return;
      if (readPlaceCookie(document.cookie).ids?.join(".") !== ids.join(".")) return;
      const canonical = new Map(body.locations.map((place) => [place.id, place]));
      const previous = new Map(current.locations.map((place) => [place.id, place]));
      current = {
        locations: ids.flatMap((id) => canonical.has(id) ? [canonical.get(id)!] : previous.has(id) ? [previous.get(id)!] : []),
        storageError: body.unavailableIds.length > 0 ? "Some saved places could not be restored. Reload to retry, or choose another place." : null,
      };
      if (consent === "allow") writeLocal(current.locations);
      emit();
    } catch {
      if (controller.signal.aborted || revision !== initialRevision) return;
      current = { ...current, storageError: "Saved places could not be restored right now. Reload to retry, or choose them again." };
      emit();
    } finally {
      if (restoration === controller) { restoration = null; restoringIds = null; }
    }
  })();
}

export function getSelection(): Selection {
  if (typeof window === "undefined") return EMPTY_SELECTION;
  if (!loaded) { loaded = true; loadBrowserSelection(); }
  return current;
}

export function getConsent(): ConsentChoice {
  if (typeof window === "undefined") return "undecided";
  getSelection();
  return consent;
}

function onStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY || event.key === CONSENT_STORAGE_KEY || event.key === null) {
    cancelRestoration(); loadBrowserSelection(); startRestoration(); emit();
  }
}

export function subscribeSelection(listener: () => void) {
  listeners.add(listener);
  getSelection();
  startRestoration();
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function chooseConsent(choice: "allow" | "tab") {
  getSelection();
  consent = choice;
  let saved = true;
  if (choice === "tab") {
    cancelRestoration();
    const cleared = clearPersistentPreferences();
    saved = writeTab(current.locations);
    current = { ...current, storageError: !cleared ? "Some browser preferences could not be cleared. Your selection stays in this tab." : !saved ? "Your browser could not save this preference. Your places are available in this tab." : null };
  } else {
    try { window.sessionStorage.removeItem(TAB_CONSENT_KEY); window.sessionStorage.removeItem(TAB_STORAGE_KEY); } catch { saved = false; }
    let cookieConsent = false;
    let localConsent = false;
    try { document.cookie = consentCookieHeader(secure()); cookieConsent = hasCookieConsent(document.cookie); } catch { /* The permitted localStorage fallback may still work. */ }
    try { window.localStorage.setItem(CONSENT_STORAGE_KEY, "allow"); localConsent = true; } catch { /* The permitted cookie fallback may still work. */ }
    const ids = restoringIds ?? pendingIds;
    const placesSaved = ids ? writeCookieIds(ids) : persistSelection(current.locations);
    saved = saved && (cookieConsent || localConsent) && placesSaved;
    current = { ...current, storageError: saved ? null : "Your browser could not save this preference. Your places are available in this tab." };
    migrateCookie = false;
  }
  emit();
}

export function resetPreferences() {
  cancelRestoration();
  let cleared = clearPersistentPreferences();
  try { window.sessionStorage.removeItem(TAB_CONSENT_KEY); window.sessionStorage.removeItem(TAB_STORAGE_KEY); } catch { cleared = false; }
  consent = "undecided";
  current = { locations: [], storageError: cleared ? null : "Some saved preferences could not be cleared by this browser." };
  emit();
}

function save(locations: Location[]) {
  cancelRestoration();
  current = { locations, storageError: null };
  if (!persistSelection(locations)) current.storageError = "Your browser could not save this change. Your places are available in this tab.";
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
