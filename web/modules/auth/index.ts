import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/app-schema";
import { magicLink } from "./email";

// Google 登录在配置了 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET 后才启用。
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const providers: Provider[] = [magicLink()];
if (googleEnabled) providers.push(Google({ allowDangerousEmailAccountLinking: true }));

const nextAuth = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers,
  session: { strategy: "database", maxAge: 60 * 24 * 60 * 60 },
  pages: { signIn: "/login", verifyRequest: "/login/check" },
  callbacks: {
    // 只返回需要的字段:数据库会话对象里还有 sessionToken,不能下发给浏览器
    session: ({ session, user }) => ({
      expires: session.expires,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
    }),
  },
  trustHost: true,
});

export const { handlers, signIn, signOut } = nextAuth;

/** 读取会话。Auth.js 内部会用到随机数,先声明这是请求时数据,避免被当成预渲染内容。 */
export async function auth() {
  await connection();
  return nextAuth.auth();
}

/** 当前登录用户的 id;未登录时跳转到登录页。所有用户数据查询都从这里取 user_id。 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  return id;
}

export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
