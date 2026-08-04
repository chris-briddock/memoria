import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { VersionBadge } from "@/components/version-badge";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Memoria",
    template: "%s · Memoria",
  },
  description: "A private photo vault for the family.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink">
        {children}
        <VersionBadge />
      </body>
    </html>
  );
}
