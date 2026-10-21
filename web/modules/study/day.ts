// 学习日按北京时间计算(目标用户在中国),凌晨 4 点切换,避免熬夜学习被算到第二天。
const OFFSET_MS = (8 - 4) * 3600_000;

/** 时间点所属的学习日,格式 YYYY-MM-DD。 */
export function studyDay(t: Date): string {
  return new Date(t.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** 学习日结束的时刻(次日 4 点,北京时间)。 */
export function dayEnd(t: Date): Date {
  const d = studyDay(t);
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86400_000 - OFFSET_MS);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

/** 连续打卡天数:截止今天或昨天、每天都有学习记录的天数。days 为有记录的学习日。 */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
