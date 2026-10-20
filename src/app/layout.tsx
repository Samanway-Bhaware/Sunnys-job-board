import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sunny's Job Board",
  // A private site. The X-Robots-Tag header in src/proxy.ts is the other half.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
