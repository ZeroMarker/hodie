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
  next,
  submit,
}: {
  list?: string;
  dailyNew?: number;
  retention?: number;
  next: string;
  submit: string;
}) {
  return (
    <form action={updateProfile} className="space-y-6">
      <input type="hidden" name="next" value={next} />
      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold">备考目标</legend>
        {LISTS.map((l) => (
          <label key={l} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 has-[:checked]:border-zinc-900">
            <input type="radio" name="list" value={l} defaultChecked={l === list} required />
            <span>{EXAMS[l]}</span>
            <span className="ml-auto text-sm text-zinc-400">{listName(l)} 词书</span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="font-semibold">每天新词数</span>
        <select name="dailyNew" defaultValue={dailyNew} className="mt-2 block w-full rounded-lg border border-zinc-200 px-3 py-2">
          {[5, 10, 15, 20].map((n) => (
            <option key={n} value={n}>
              {n} 个(约 {Math.round(n * 1.5)} 分钟)
            </option>
          ))}
        </select>
      </label>
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
