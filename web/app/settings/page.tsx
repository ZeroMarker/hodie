import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions";
import { ProfileForm } from "@/components/profile-form";
import { auth } from "@/modules/auth";
import { getProfile } from "@/modules/study/profile";

export default function Settings() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <Suspense>
        <Inner />
      </Suspense>
    </main>
  );
}

async function Inner() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  const profile = await getProfile(userId);
  if (!profile) redirect("/onboarding");
  return (
    <>
      <ProfileForm
        list={profile.list}
        dailyNew={profile.dailyNew}
        retention={profile.retention}
        next="/"
        submit="保存"
      />
      <section className="space-y-3 border-t border-zinc-200 pt-6 text-sm">
        <p className="text-zinc-500">已登录:{session.user?.email}</p>
        <Link href="/placement" className="block text-zinc-700 underline">
          重新做词汇量测试
        </Link>
        <form action={logout}>
          <button className="text-red-600 underline">退出登录</button>
        </form>
      </section>
    </>
  );
}
