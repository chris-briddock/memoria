import type { Metadata } from "next";
import { requireAdmin } from "@/lib/dal";
import { apiGetRequired } from "@/lib/api-client";
import { CreateInviteForm } from "./create-invite-form";
import { RevokeInviteButton } from "../revoke-invite-button";

export const metadata: Metadata = { title: "Family" };

type Invite = {
  id: string;
  code: string;
  note: string | null;
  claimedAt: string | Date | null;
  expiresAt: string | Date | null;
  createdAt: string | Date;
};

type Member = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "member";
  createdAt: string;
  photoCount: number;
};

export default async function FamilyPage() {
  await requireAdmin();
  const [invites, members] = await Promise.all([
    apiGetRequired<Invite[]>("/api/invites"),
    apiGetRequired<Member[]>("/api/members"),
  ]);

  const open = invites.filter((i) => !i.claimedAt);
  const used = invites.filter((i) => i.claimedAt);

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Family
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Anyone with an unused invite code can join the vault. Codes expire
          after 30 days.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-medium tracking-tight">
          Invites
        </h2>

        <CreateInviteForm />

        {open.length === 0 ? (
          <p className="text-sm text-ink-faint">No unused invites.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {open.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5"
              >
                <code className="rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-sm tracking-wider text-ink">
                  {invite.code}
                </code>
                <span className="text-sm text-ink-soft">{invite.note ?? "—"}</span>
                <span className="ml-auto text-xs text-ink-faint">
                  {invite.expiresAt
                    ? `Expires ${new Date(invite.expiresAt).toLocaleDateString("en-GB")}`
                    : "No expiry"}
                </span>
                <RevokeInviteButton inviteId={invite.id} />
              </li>
            ))}
          </ul>
        )}

        {used.length > 0 && (
          <details className="text-sm text-ink-soft">
            <summary className="cursor-pointer">
              {used.length} claimed {used.length === 1 ? "invite" : "invites"}
            </summary>
            <ul className="mt-2 space-y-1 pl-4 text-ink-faint">
              {used.map((invite) => (
                <li key={invite.id}>
                  <code className="font-mono">{invite.code}</code>
                  {invite.note && ` · ${invite.note}`}
                  {invite.claimedAt &&
                    ` · claimed ${new Date(invite.claimedAt).toLocaleDateString("en-GB")}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-medium tracking-tight">
          Members
        </h2>
        <ul className="card divide-y divide-line">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium">{member.name ?? member.email}</p>
                <p className="text-xs text-ink-faint">{member.email}</p>
              </div>
              <span className="ml-auto text-xs text-ink-faint">
                {member.photoCount}{" "}
                {member.photoCount === 1 ? "photo" : "photos"}
              </span>
              {member.role === "admin" && (
                <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft">
                  admin
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
