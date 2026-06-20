import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrabajoCR 🇨🇷 — Empleos Remotos y Locales en Costa Rica",
  description: "Buscador de empleos consolidado y validador de compatibilidad de currículum (CV) impulsado por IA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col bg-background text-text">
        {children}
      </body>
    </html>
  );
}
export { inter }; // Export font if needed elsewhere
