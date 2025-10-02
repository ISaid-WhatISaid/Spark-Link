export const metadata = {
  title: "Spark Link",
  description: "PIN-gated dating profile prototype",
};

import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
