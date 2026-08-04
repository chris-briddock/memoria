"use client";

import { useTransition } from "react";
import { revokeInvite } from "@/lib/actions/photos";

export function RevokeInviteButton({ inviteId }: Readonly<{ inviteId: string }>) {
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
