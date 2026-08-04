"use client";

import { useTransition } from "react";

export function RevokeInviteButton({
  inviteId,
  revokeInvite,
}: Readonly<{
  inviteId: string;
  /** Server action, passed by the server page so this bundle never imports it. */
  revokeInvite: (inviteId: string) => Promise<void>;
}>) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-ghost"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await revokeInvite(inviteId);
        })
      }
    >
      Revoke
    </button>
  );
}
