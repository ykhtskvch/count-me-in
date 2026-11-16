import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Count Me In",
  description: "One-off evenings with people who live nearby. No organiser needed.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
