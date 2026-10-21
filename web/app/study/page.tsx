import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUserId } from "@/modules/auth";
import { getQueue } from "@/modules/study/queue";
import { Session } from "./session";

export default function StudyPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Suspense fallback={<p className="text-zinc-500">正在准备今天的任务…</p>}>
        <Study />
      </Suspense>
    </main>
  );
}

async function Study() {
  const userId = await requireUserId();
  const queue = await getQueue(userId);
  if (!queue) redirect("/onboarding");
  return <Session items={queue.items} />;
}
