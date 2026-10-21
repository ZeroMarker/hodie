"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function speak(text: string) {
  if (!supported()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/** 浏览器朗读按钮;不支持 Web Speech API 的浏览器不显示。 */
export function Speak({ text, className = "" }: { text: string; className?: string }) {
  const ok = useSyncExternalStore(subscribe, supported, () => false);
  if (!ok) return null;
  return (
    <button
      type="button"
      onClick={() => speak(text)}
      aria-label={`朗读 ${text}`}
      className={`rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 ${className}`}
    >
      🔊
    </button>
  );
}
