import { updateProfile } from "@/app/actions";
import { LISTS } from "@/modules/study/profile";
import { listName } from "@/modules/vocab/card";

const EXAMS: Record<string, string> = {
  zk: "中考",
  gk: "高考",
  cet4: "大学英语四级",
  cet6: "大学英语六级",
  ky: "考研",
  ielts: "雅思",
  toefl: "托福",
  gre: "GRE",
  ngsl: "没有考试目标(NGSL 常用词)",
};

export function ProfileForm({
  list = "cet4",
  dailyNew = 10,
  retention,
  adaptive = true,
  progress,
  next,
  submit,
}: {
  list?: string;
  dailyNew?: number;
  retention?: number;
  adaptive?: boolean;
  /** 各词书的已学进度,只在设置页显示 */
  progress?: Record<string, { total: number; learned: number }>;
  next: string;
  submit: string;
}) {
  return (
    <form action={updateProfile} className="space-y-6">
      <input type="hidden" name="next" value={next} />
      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold">备考目标</legend>
        {progress && <p className="text-sm text-zinc-500">换词书后已学的词照常复习,新词从新词书里取;一本学完会自动接下一本。</p>}
        {LISTS.map((l) => (
          <label key={l} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 has-[:checked]:border-zinc-900">
            <input type="radio" name="list" value={l} defaultChecked={l === list} required />
            <span>{EXAMS[l]}</span>
            <span className="ml-auto text-right text-sm text-zinc-400">
              {listName(l)} 词书
              {progress?.[l] && (
                <span className="block text-xs">
                  已学 {progress[l].learned}/{progress[l].total}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="font-semibold">每天新词数</span>
        <select name="dailyNew" defaultValue={dailyNew} className="mt-2 block w-full rounded-lg border border-zinc-200 px-3 py-2">
          {Array.from({ length: 16 }, (_, i) => i + 5).map((n) => (
            <option key={n} value={n}>
              {n} 个(约 {Math.round(n * 1.5)} 分钟)
            </option>
          ))}
        </select>
      </label>
      {retention !== undefined && (
        <label className="flex items-start gap-3">
          <input type="checkbox" name="adaptive" defaultChecked={adaptive} className="mt-1" />
          <span>
            <span className="font-semibold">自动调整每天新词数</span>
            <span className="block text-sm text-zinc-500">
              每天按最近 7 天的复习情况调整:正确率高于 92% 且没有积压时加 2 个,低于 80% 或有积压时减 3 个(5 到 20 个)。
            </span>
          </span>
        </label>
      )}
      {retention !== undefined && (
        <label className="block">
          <span className="font-semibold">目标记忆保持率</span>
          <select name="retention" defaultValue={String(retention)} className="mt-2 block w-full rounded-lg border border-zinc-200 px-3 py-2">
            <option value="0.85">85%(复习少,遗忘多)</option>
            <option value="0.9">90%(推荐)</option>
            <option value="0.95">95%(复习多,记得牢)</option>
          </select>
        </label>
      )}
      <button className="w-full rounded-lg bg-zinc-900 py-3 font-semibold text-white">{submit}</button>
    </form>
  );
}
