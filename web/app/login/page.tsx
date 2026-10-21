import { redirect } from "next/navigation";
import { Suspense } from "react";
import { emailSignIn, googleSignIn } from "@/app/actions";
import { currentUserId, googleEnabled } from "@/modules/auth";

const ERRORS: Record<string, string> = {
  email: "请输入有效的邮箱地址。",
  Verification: "登录链接已失效或已使用过,请重新获取。",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto max-w-sm space-y-6 p-6 py-12">
      <h1 className="text-2xl font-bold">登录 Hodie</h1>
      <p className="text-zinc-500">第一次使用会自动注册。</p>
      <Suspense>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await currentUserId()) redirect("/");
  const { error } = await searchParams;
  const message = typeof error === "string" ? (ERRORS[error] ?? "登录失败,请重试。") : null;
  return (
    <>
      {message && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>}
      <form action={emailSignIn} className="space-y-3">
        <input
          type="email"
          name="email"
          required
          placeholder="邮箱地址"
          autoComplete="email"
          className="w-full rounded-lg border border-zinc-300 px-4 py-3"
        />
        <button className="w-full rounded-lg bg-zinc-900 py-3 font-semibold text-white">发送登录链接</button>
      </form>
      {googleEnabled && (
        <form action={googleSignIn}>
          <button className="w-full rounded-lg border border-zinc-300 bg-white py-3 font-semibold">使用 Google 登录</button>
        </form>
      )}
    </>
  );
}
