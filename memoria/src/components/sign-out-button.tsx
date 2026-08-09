"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setPending(true);
    const result = await apiSubmit<{ redirect?: string }>(`/api/auth/signout`, {
      method: "POST",
    });
    setPending(false);
    if (result.ok && result.data?.redirect) {
      router.push(result.data.redirect);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="btn-ghost min-h-9 px-3 py-1.5"
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
