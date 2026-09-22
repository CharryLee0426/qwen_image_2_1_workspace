import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwen Image — Studio",
  description: "A personal image studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
