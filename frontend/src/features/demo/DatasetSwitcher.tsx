import Link from "next/link";
import { SYNTHETIC_SIZES, type SyntheticSize } from "./synthetic-graph";

const link = "rounded px-2 py-1 font-mono text-[11px] transition-colors";
const countFormat = new Intl.NumberFormat("en-US");

/** Lives with the demo code, so the explorer itself knows nothing about sample datasets. */
export function DatasetSwitcher({ current }: { current: SyntheticSize | "sample" }) {
  const style = (active: boolean) =>
    `${link} ${active ? "bg-raised text-cyan" : "text-faint hover:text-text"}`;
  return (
    <nav aria-label="Demo dataset" className="hidden shrink-0 items-center gap-0.5 md:flex">
      <Link
        href="/explore/demo"
        aria-current={current === "sample" ? "page" : undefined}
        className={style(current === "sample")}
      >
        Sample
      </Link>
      {SYNTHETIC_SIZES.map((size) => (
        <Link
          key={size}
          href={`/explore/demo/stress/${size}`}
          aria-current={current === size ? "page" : undefined}
          className={style(current === size)}
        >
          {countFormat.format(size)}
        </Link>
      ))}
    </nav>
  );
}
