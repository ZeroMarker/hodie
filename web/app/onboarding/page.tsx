import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProfileForm } from "@/components/profile-form";
import { requireUserId } from "@/modules/auth";
import { getProfile } from "@/modules/study/profile";

export default function Onboarding() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">选择你的目标</h1>
      <p className="text-zinc-500">按考试选词书,之后可以在设置里更改。</p>
      <Suspense>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  const userId = await requireUserId();
  if (await getProfile(userId)) redirect("/");
  return <ProfileForm next="/placement" submit="下一步:词汇量测试" />;
}
