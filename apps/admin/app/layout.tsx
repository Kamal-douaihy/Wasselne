import type { ReactNode } from "react";

export const metadata = {
  title: "Wasselne Admin",
  description: "Wasselne operations console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
