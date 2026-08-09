import { Nav } from "@/components/nav";
import { apiGetRequired } from "@/lib/api-client";
import type { SessionUser } from "@/lib/types";

export default async function VaultLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await apiGetRequired<SessionUser>("/api/me");

  return (
    <>
      <Nav user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
      <footer className="border-t border-line py-6 text-center text-xs text-ink-faint">
        Memoria · your photos, on your own hardware
      </footer>
    </>
  );
}
