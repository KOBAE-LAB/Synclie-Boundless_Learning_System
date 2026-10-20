// 順番のある操作(流れ)の見出し・ボタンに付ける、丸い番号。画面のあちこちで同じ見た目にそろえる。
export function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.6875rem] font-semibold text-accent"
    >
      {n}
    </span>
  );
}
