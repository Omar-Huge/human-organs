import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * Display face. Archivo is a variable font with a width axis, which is the point:
 * pushed expanded it reads like a stamped equipment nameplate rather than a generic
 * grotesque. Only headings and entity names use it.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // Requesting the width axis means the whole weight range comes as a variable font;
  // next/font rejects an explicit weight list alongside axes. That suits us — the
  // display face needs both the wdth axis and a heavy weight.
  axes: ["wdth"],
  display: "swap",
});

/**
 * Body face. Drawn for technical documentation; carries all prose.
 *
 * Regular only. Nothing in the interface uses a heavier body weight — hierarchy comes
 * from the display face, colour and the mono/sans distinction — so requesting 500 and
 * 600 would ship two font files that are downloaded and never painted.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

/** Sibling of the body face. Carries every figure, unit, date and coordinate. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Soft Machinery — the organs that keep you running",
  description:
    "An interactive 3D explorer for nine human organs: what each one does, and which part of it does the work.",
  applicationName: "Soft Machinery",
  authors: [{ name: "Soft Machinery" }],
  openGraph: {
    title: "Soft Machinery",
    description:
      "Nine human organs, explorable in 3D. Every fact carries its source.",
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "Soft Machinery",
    description: "Nine human organs, explorable in 3D.",
  },
};

export const viewport: Viewport = {
  themeColor: "#e6e9ec",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
