"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { chooseConsent, getConsent, resetPreferences, subscribeSelection } from "@/features/locations/store";
import styles from "./CookiePreferences.module.css";

export function CookiePreferences() {
  const consent = useSyncExternalStore(subscribeSelection, getConsent, () => "undecided");
  const [manageOpen, setManageOpen] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const allow = useRef<HTMLButtonElement>(null);
  const visible = consent === "undecided" || manageOpen;

  function choose(choice: "allow" | "tab") {
    chooseConsent(choice);
    setManageOpen(false);
    control.current?.focus({ preventScroll: true });
  }

  return <>
    <div className={styles.footer}><button ref={control} className={styles.manage} onClick={() => { setManageOpen(true); requestAnimationFrame(() => allow.current?.focus({ preventScroll: true })); }}>Cookie preferences</button></div>
    {visible && <aside className={styles.banner} role="dialog" aria-modal="false" aria-labelledby="cookie-preference-heading" onKeyDown={event => { if (event.key === "Escape" && consent !== "undecided") { setManageOpen(false); control.current?.focus({ preventScroll: true }); } }}>
      <div className={styles.copy}><h2 id="cookie-preference-heading">Remember your places?</h2><p>Allow cookies to save your four places in this browser. Only this tab keeps them for this visit. We do not use analytics.</p>{manageOpen && <p className={styles.status}>Current choice: {consent === "allow" ? "remember places" : consent === "tab" ? "only this tab" : "not chosen"}.</p>}</div>
      <div className={styles.actions}><button ref={allow} className={styles.allow} onClick={() => choose("allow")}>Allow cookies</button><button className={styles.tab} onClick={() => choose("tab")}>Only this tab</button>{manageOpen && <><button className={styles.reset} onClick={() => { resetPreferences(); setManageOpen(false); requestAnimationFrame(() => allow.current?.focus({ preventScroll: true })); }}>Reset saved places</button>{consent !== "undecided" && <button className={styles.reset} onClick={() => { setManageOpen(false); control.current?.focus({ preventScroll: true }); }}>Close preferences</button>}</>}</div>
    </aside>}
  </>;
}
