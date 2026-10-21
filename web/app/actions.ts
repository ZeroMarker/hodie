"use server";

import { redirect } from "next/navigation";
import { requireUserId, signIn, signOut } from "@/modules/auth";
import { bandQuestions, savePlacement } from "@/modules/study/placement";
import type { BandResult } from "@/modules/study/placement-rules";
import { saveProfile } from "@/modules/study/profile";
import { type SubmittedLog, submitLogs } from "@/modules/study/submit";

export async function emailSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/login?error=email");
  await signIn("email", { email, redirectTo: "/" });
}

export async function googleSignIn() {
  await signIn("google", { redirectTo: "/" });
}

export async function logout() {
  await signOut({ redirectTo: "/" });
}

export async function updateProfile(formData: FormData) {
  const userId = await requireUserId();
  await saveProfile(userId, {
    list: String(formData.get("list")),
    dailyNew: Number(formData.get("dailyNew")),
    retention: formData.has("retention") ? Number(formData.get("retention")) : undefined,
  });
  redirect(String(formData.get("next") ?? "/"));
}

export async function loadBand(band: number) {
  await requireUserId();
  return bandQuestions(band);
}

export async function finishPlacement(results: BandResult[]) {
  const userId = await requireUserId();
  await savePlacement(userId, results);
}

export async function submitReviews(logs: SubmittedLog[]) {
  const userId = await requireUserId();
  return submitLogs(userId, logs);
}
