import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";

// Hiring trends: roles posted vs taken down per day, from the `hiring_trends`
// table the pipeline writes after each daily pull (schema_trends.sql). One row
// per (day, firm, metro); this view sums whatever the filter bar leaves in.

const RANGES = [
  { v: 7, label: "7d" },
  { v: 30, label: "30d" },
  { v: "all", label: "All" },
];

// Supabase caps each response at 1000 rows (~10 days of firm × metro rows)
async function fetchAllTrends() {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await supabase
      .from("hiring_trends")
      .select("*")
      .order("day", { ascending: true })
      .order("firm", { ascending: true })
      .order("metro", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) return res;
    rows.push(...res.data);
    if (res.data.length < PAGE) return { data: rows, error: null };
  }
}

const fmtDay = (d) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export default function Trends({ metro, category, q, categoryOf }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState(30);

  useEffect(() => {
    (async () => {
      const res = await fetchAllTrends();
      if (res.error) {
        setError(`Couldn't load hiring trends (run schema_trends.sql?): ${res.error.message}`);
        setRows([]);
      } else setRows(res.data || []);
    })();
  }, []);

  const needle = q.trim().toLowerCase();
  const kept = useMemo(
    () =>
      (rows || []).filter(
        (r) =>
          (metro === "all" || r.metro === metro) &&
          (category === "all" || categoryOf(r.firm) === category) &&
          (!needle || r.firm.toLowerCase().includes(needle))
      ),
    [rows, metro, category, needle, categoryOf]
  );

  // every day the pipeline recorded (even if the filters leave it empty)
  const allDays = useMemo(() => [...new Set((rows || []).map((r) => r.day))].sort(), [rows]);
  const days = useMemo(() => {
    if (range === "all" || !allDays.length) return allDays;
    const last = new Date(allDays[allDays.length - 1] + "T00:00:00Z");
    last.setUTCDate(last.getUTCDate() - (range - 1));
    const from = last.toISOString().slice(0, 10);
    return allDays.filter((d) => d >= from);
  }, [allDays, range]);

  const daily = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, { day: d, posted: 0, removed: 0, active: 0 }]));
    for (const r of kept) {
      const x = m[r.day];
      if (!x) continue;
      x.posted += r.new_count;
      x.removed += r.removed_count;
      x.active += r.active_count;
    }
    return days.map((d) => m[d]);
  }, [kept, days]);

  const lastDay = days[days.length - 1];
  const firms = useMemo(() => {
    const inRange = new Set(days);
    const m = {};
    for (const r of kept) {
      if (!inRange.has(r.day)) continue;
      const f = (m[r.firm] ||= { firm: r.firm, posted: 0, removed: 0, active: 0 });
      f.posted += r.new_count;
      f.removed += r.removed_count;
      if (r.day === lastDay) f.active += r.active_count;
    }
    return Object.values(m)
      .filter((f) => f.posted || f.removed)
      .sort((a, b) => b.posted + b.removed - (a.posted + a.removed) || a.firm.localeCompare(b.firm));
  }, [kept, days, lastDay]);

  const tot = daily.reduce(
    (t, d) => ({ posted: t.posted + d.posted, removed: t.removed + d.removed }),
    { posted: 0, removed: 0 }
  );
  const live = daily.length ? daily[daily.length - 1].active : 0;

  const [exporting, setExporting] = useState(false);
  async function downloadExcel() {
    setExporting(true);
    try {
      await exportTrends({
        daily,
        firms,
        detail: kept.filter((r) => days.includes(r.day)),
        categoryOf,
        filters: { metro, category, q: q.trim(), range, from: days[0], to: lastDay },
      });
    } catch (e) {
      setError(`Excel export failed: ${e.message || e}`);
    } finally {
      setExporting(false);
    }
  }

  if (rows === null) return <div className="meta">Loading trends…</div>;

  return (
    <div className="trends">
      {error && <div className="err">{error}</div>}
      <div className="trends-top">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.v} aria-pressed={range === r.v} onClick={() => setRange(r.v)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="meta trends-meta">
          {days.length
            ? `${fmtDay(days[0])} – ${fmtDay(lastDay)} · ${days.length} day${days.length === 1 ? "" : "s"} recorded`
            : "No history yet — it fills in after each daily pull."}
        </span>
        {days.length > 0 && (
          <button
            className="exportBtn"
            onClick={downloadExcel}
            disabled={exporting}
            title="Download these trends (current filters and range) as an Excel workbook"
          >
            {exporting ? "Preparing…" : "⬇ Excel"}
          </button>
        )}
      </div>

      <div className="trend-stats">
        <TrendStat n={tot.posted} label="posted" cls="t-posted" />
        <TrendStat n={tot.removed} label="taken down" cls="t-removed" />
        <TrendStat n={signed(tot.posted - tot.removed)} label="net" />
        <TrendStat n={live} label="live now" />
      </div>

      {daily.length > 0 && <DailyChart daily={daily} />}

      <p className="trends-note">
        <b>Posted</b> = new on the board that day. <b>Taken down</b> = gone from the firm's own careers
        site since the day before (roles we merely filter out don't count). A day the pull didn't run rolls
        into the next day's numbers; a firm's first day in the pipeline isn't counted as new hiring.
      </p>

      {firms.length > 0 && (
        <>
        <p className="trend-cap">By firm · {range === "all" ? "all time" : `last ${range} days`}</p>
        <table className="trend-table">
          <thead>
            <tr>
              <th scope="col">Firm</th>
              <th scope="col" className="num">Posted</th>
              <th scope="col" className="num">Taken down</th>
              <th scope="col" className="num">Net</th>
              <th scope="col" className="num">Live</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.firm}>
                <th scope="row">
                  {f.firm}
                  <span className="trend-cat">{categoryOf(f.firm)}</span>
                </th>
                <td className="num">{f.posted}</td>
                <td className="num">{f.removed}</td>
                <td className={`num ${f.posted - f.removed > 0 ? "up" : f.posted - f.removed < 0 ? "down" : ""}`}>
                  {signed(f.posted - f.removed)}
                </td>
                <td className="num">{f.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}

      {daily.length > 0 && (
        <details className="trend-daily">
          <summary>Daily numbers</summary>
          <table className="trend-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="num">Posted</th>
                <th scope="col" className="num">Taken down</th>
                <th scope="col" className="num">Net</th>
                <th scope="col" className="num">Live</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row">{fmtDay(d.day)}</th>
                  <td className="num">{d.posted}</td>
                  <td className="num">{d.removed}</td>
                  <td className="num">{signed(d.posted - d.removed)}</td>
                  <td className="num">{d.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function TrendStat({ n, label, cls = "" }) {
  return (
    <div className={`stat ${cls}`}>
      <span className="num">{n}</span>
      <span className="lbl">{label}</span>
    </div>
  );
}

// Diverging daily bars: posted rises above the zero line, taken down hangs
// below it. Each day's column is its own hover/focus target.
function DailyChart({ daily }) {
  const box = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220, padL = 34, padR = 6, padT = 10, padB = 26;
  const plotW = w - padL - padR, plotH = H - padT - padB;
  const maxP = Math.max(1, ...daily.map((d) => d.posted));
  const maxR = Math.max(1, ...daily.map((d) => d.removed));
  const step = niceStep((maxP + maxR) / 6);
  const top = Math.ceil(maxP / step) * step;
  const bot = Math.ceil(maxR / step) * step;
  const y = (v) => padT + ((top - v) / (top + bot)) * plotH;
  const ticks = [];
  for (let v = -bot; v <= top; v += step) ticks.push(v);

  const band = plotW / daily.length;
  const bw = Math.max(3, Math.min(26, band * 0.62));
  const every = Math.max(1, Math.ceil(58 / band)); // keep x labels from colliding
  const h = hover != null ? daily[hover] : null;

  return (
    <div className="trend-chart" ref={box}>
      <div className="trend-legend" aria-hidden="true">
        <span><i className="key t-posted" /> Posted</span>
        <span><i className="key t-removed" /> Taken down</span>
      </div>
      <svg width={w} height={H} role="img" aria-label="Roles posted and taken down per day">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} className={v === 0 ? "axis0" : "grid"} />
            <text x={padL - 6} y={y(v)} dy="0.32em" textAnchor="end" className="tick">
              {Math.abs(v)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const cx = padL + band * i + band / 2;
          const dim = hover != null && hover !== i ? 0.45 : 1;
          return (
            <g key={d.day} opacity={dim}>
              {d.posted > 0 && <path className="bar-posted" d={barPath(cx - bw / 2, y(0) - 1, y(d.posted), bw)} />}
              {d.removed > 0 && <path className="bar-removed" d={barPath(cx - bw / 2, y(0) + 1, y(-d.removed), bw)} />}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="tick">
                  {fmtDay(d.day)}
                </text>
              )}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d.day)}: ${d.posted} posted, ${d.removed} taken down`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {h && (
        <div
          className="trend-tip"
          style={(() => {
            // sit beside the hovered column, never on top of its bars
            const cx = padL + band * hover + band / 2;
            return cx + bw / 2 + 170 < w
              ? { left: cx + bw / 2 + 10 }
              : { left: cx - bw / 2 - 10, transform: "translateX(-100%)" };
          })()}
        >
          <div className="tip-day">{fmtDay(h.day)}</div>
          <div><i className="tip-key t-posted" /><b>{h.posted}</b> posted</div>
          <div><i className="tip-key t-removed" /><b>{h.removed}</b> taken down</div>
          <div className="tip-sub">net {signed(h.posted - h.removed)} · {h.active} live</div>
        </div>
      )}
    </div>
  );
}

// bar from the baseline y0 to the data end y1, 4px rounded at the data end only
function barPath(x, y0, y1, w) {
  const up = y1 < y0;
  const len = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, len);
  const s = up ? 1 : -1; // direction toward baseline from the data end
  return [
    `M${x},${y0}`,
    `V${y1 + s * r}`,
    `Q${x},${y1} ${x + r},${y1}`,
    `H${x + w - r}`,
    `Q${x + w},${y1} ${x + w},${y1 + s * r}`,
    `V${y0}`,
    "Z",
  ].join(" ");
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// Excel workbook of what the view shows (current filters + range): daily
// totals, the per-firm table, the underlying day × firm × metro rows for
// pivoting, and a sheet recording the filters and definitions. The writer is
// loaded on demand so it stays out of the main bundle.
async function exportTrends({ daily, firms, detail, categoryOf, filters }) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const B = (value) => ({ value, fontWeight: "bold" });
  const date = (d) => ({ value: new Date(d + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" });
  const n = (value) => ({ value, type: Number });

  const dailySheet = [
    ["Day", "Posted", "Taken down", "Net", "Live"].map(B),
    ...daily.map((d) => [date(d.day), n(d.posted), n(d.removed), n(d.posted - d.removed), n(d.active)]),
  ];
  const firmSheet = [
    ["Firm", "Firm type", "Posted", "Taken down", "Net", "Live"].map(B),
    ...firms.map((f) => [f.firm, categoryOf(f.firm), n(f.posted), n(f.removed), n(f.posted - f.removed), n(f.active)]),
  ];
  const detailSheet = [
    ["Day", "Firm", "Firm type", "Metro", "Posted", "Taken down", "Live"].map(B),
    ...detail.map((r) => [
      date(r.day), r.firm, categoryOf(r.firm), r.metro,
      n(r.new_count), n(r.removed_count), n(r.active_count),
    ]),
  ];
  const f = filters;
  const aboutSheet = [
    [B("Street Watch — hiring trends")],
    ["Exported", new Date().toLocaleString()],
    ["Days", `${f.from} to ${f.to}`],
    ["Range", f.range === "all" ? "All time" : `Last ${f.range} days`],
    ["Metro", f.metro === "all" ? "All" : f.metro],
    ["Firm type", f.category === "all" ? "All" : f.category],
    ["Firm filter", f.q || "(none)"],
    [],
    [B("Definitions")],
    ["Posted", "New on the board that day (a firm's first day in the pipeline isn't counted)."],
    ["Taken down", "Gone from the firm's own careers site since the previous day; roles we merely filter out don't count."],
    ["Live", "Roles on the board at the end of the day (By firm: on the last day of the range)."],
    ["Note", "A day the pull didn't run rolls into the next day's numbers."],
  ];

  const stem = [
    "street-watch-hiring-trends",
    f.metro !== "all" && f.metro,
    f.category !== "all" && f.category,
    f.q,
    `${f.from}_to_${f.to}`,
  ]
    .filter(Boolean)
    .join("-")
    .replace(/[^\w.-]+/g, "-");

  await writeExcelFile([
    { data: dailySheet, sheet: "Daily", columns: [{ width: 12 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 8 }], stickyRowsCount: 1 },
    { data: firmSheet, sheet: "By firm", columns: [{ width: 34 }, { width: 22 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 8 }], stickyRowsCount: 1 },
    { data: detailSheet, sheet: "Detail", columns: [{ width: 12 }, { width: 34 }, { width: 22 }, { width: 18 }, { width: 10 }, { width: 12 }, { width: 8 }], stickyRowsCount: 1 },
    { data: aboutSheet, sheet: "About", columns: [{ width: 14 }, { width: 90 }] },
  ]).toFile(`${stem}.xlsx`);
}
