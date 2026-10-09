import localFont from "next/font/local";

export const bodyFont = localFont({
  src: "../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  variable: "--font-body", display: "swap", preload: true, weight: "100 1000",
});

export const headingFont = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-heading", display: "swap", preload: true, weight: "200 800",
});
