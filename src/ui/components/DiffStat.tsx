import type { FileTotals } from "../types";

const SLOTS = 5;

export function diffstatBuckets({ adds, dels }: FileTotals): {
  green: number;
  red: number;
  empty: number;
} {
  const total = adds + dels;
  if (total === 0) return { green: 0, red: 0, empty: SLOTS };
  if (total <= SLOTS) return { green: adds, red: dels, empty: SLOTS - total };
  const green = Math.round((adds / total) * SLOTS);
  const red = SLOTS - green;
  return { green, red, empty: 0 };
}

export function DiffStat({ totals }: { totals: FileTotals }) {
  const { green, red, empty } = diffstatBuckets(totals);
  const slots: Array<"g" | "r" | "_"> = [
    ...Array<"g">(green).fill("g"),
    ...Array<"r">(red).fill("r"),
    ...Array<"_">(empty).fill("_"),
  ];
  return (
    <span className="diffstat" aria-label={`+${totals.adds} -${totals.dels}`}>
      {slots.map((s, i) => (
        <span key={i} className={`diffstat-block diffstat-${s}`} />
      ))}
    </span>
  );
}
