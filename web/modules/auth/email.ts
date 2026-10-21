import type { EmailConfig } from "next-auth/providers";

const FROM = process.env.AUTH_EMAIL_FROM ?? "Hodie <login@hodie.app>";

// 邮箱魔法链接。配置了 AUTH_RESEND_KEY 时经 Resend 发信;
// 未配置时只在开发环境把链接打印到服务端日志,生产环境直接报错。
export function magicLink(): EmailConfig {
  return {
    id: "email",
    type: "email",
    name: "邮箱",
    from: FROM,
    maxAge: 24 * 60 * 60,
    async sendVerificationRequest({ identifier: to, url }) {
      const key = process.env.AUTH_RESEND_KEY;
      if (!key) {
        if (process.env.NODE_ENV === "production") throw new Error("AUTH_RESEND_KEY 未设置");
        console.log(`[auth] 登录链接 ${to}: ${url}`);
        return;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to,
          subject: "登录 Hodie",
          text: `点击链接登录 Hodie(24 小时内有效):\n${url}\n\n如果不是你本人操作,忽略这封邮件即可。`,
          html: `<p>点击下面的按钮登录 Hodie(24 小时内有效)。</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none">登录</a></p><p style="color:#71717a">如果不是你本人操作,忽略这封邮件即可。</p>`,
        }),
      });
      if (!res.ok) throw new Error(`Resend 发信失败:${res.status} ${await res.text()}`);
    },
    options: {},
  };
}
