/**
 * Result shapes shared between server actions and the client components that
 * drive them via `useActionState`. They live in their own module — *not* in
 * the `"use server"` files — so client components can import the types without
 * dragging the server-side dependency graph (db client, bcrypt, Auth.js, S3)
 * across the client boundary.
 */

export type FormState = { error?: string } | undefined;

export type ProfileResult = { error?: string; success?: string } | undefined;

export type UnlinkResult = { error?: string } | undefined;
