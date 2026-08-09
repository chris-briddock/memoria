"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

export function RevokeInviteButton({
  inviteId,
}: Readonly<{ inviteId: string }>) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="btn-ghost"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await apiSubmit(`/api/invites/${inviteId}`, {
            method: "DELETE",
          });
          if (result.ok) router.refresh();
        })
      }
    >
      Revoke
    </button>
  );
}
