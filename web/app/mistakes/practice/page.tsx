import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Session } from "@/app/study/session";
import { requireUserId } from "@/modules/auth";
import { getPracticeQueue } from "@/modules/study/queue";

export default function PracticePage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Suspense fallback={<p className="text-zinc-500">正在准备错题…</p>}>
        <Practice />
      </Suspense>
    </main>
  );
}

async function Practice() {
  const userId = await requireUserId();
  const items = await getPracticeQueue(userId);
  if (!items) redirect("/onboarding");
  return <Session items={items} practice />;
}
