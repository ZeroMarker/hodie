import { Suspense } from "react";
import { requireUserId } from "@/modules/auth";
import { PlacementTest } from "./test";

export default function Placement() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">词汇量测试</h1>
      <p className="text-zinc-500">
        选出每个词的中文意思,不认识就选「不认识」,不要猜。约 2 分钟,测出来已经掌握的常用词不会再出现在学习里。
      </p>
      <Suspense>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  await requireUserId();
  return <PlacementTest />;
}
