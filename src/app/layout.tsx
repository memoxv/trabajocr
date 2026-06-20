import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrabajosCR 🇨🇷 — Empleos Remotos y Locales en Costa Rica",
  description: "Buscador de empleos consolidado y validador de compatibilidad de currículum (CV) impulsado por IA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <body className={`${plusJakartaSans.className} min-h-full flex flex-col bg-background text-text`}>
        {children}
      </body>
    </html>
  );
}
export { plusJakartaSans };

