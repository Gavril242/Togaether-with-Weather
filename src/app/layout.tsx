import type { Metadata } from "next";
import { RoundBlobCursor } from "@/components/reactbits/RoundBlobCursor";
import { CookiePreferences } from "@/components/CookiePreferences";
import { bodyFont, headingFont } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fourcast | Four places. One atmosphere.",
  description: "Choose four places, follow their real weather and local time, and explore a responsive atmospheric sky.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}><body><RoundBlobCursor /><a href="#main" className="skip-link">Skip to dashboard</a>{children}<CookiePreferences /></body></html>;
}
