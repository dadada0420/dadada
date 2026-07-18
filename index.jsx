import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend, ResponsiveContainer,
} from "recharts";

/* ──────────────────────────────────────────────
   가상 중화 적정 실험실
   · 염기: 0.100 M NaOH (고정) · 산: 25.0 mL (고정)
   · 산의 종류(실제 Ka)와 농도에 따라 적정 곡선이 달라짐
   · 학생 제출 데이터 → 공유 저장소 → 교사 대시보드
   ────────────────────────────────────────────── */

const T = {
  ink: "#10333F",
  teal: "#114B5F",
  tealSoft: "#EAF2F4",
  amber: "#F4A259",
  amberDeep: "#D97F2E",
  line: "#D8E3E7",
  sub: "#5F6B70",
};

const ACIDS = [
  { id: "hcl",  name: "염산",           formula: "HCl",     kind: "강산", Ka: 1e9,    pKaText: "완전 이온화" },
  { id: "hcooh", name: "폼산",          formula: "HCOOH",   kind: "약산", Ka: 1.8e-4, pKaText: "Ka = 1.8×10⁻⁴ (pKa 3.75)" },
  { id: "ch3cooh", name: "아세트산",    formula: "CH₃COOH", kind: "약산", Ka: 1.8e-5, pKaText: "Ka = 1.8×10⁻⁵ (pKa 4.76)" },
  { id: "hclo", name: "하이포아염소산", formula: "HClO",    kind: "약산", Ka: 3.0e-8, pKaText: "Ka = 3.0×10⁻⁸ (pKa 7.53)" },
];
const CONCS = [0.05, 0.1, 0.2];
const VA = 25.0;   // 산 부피 mL
const CB = 0.1;    // NaOH 농도 M
const BURETTE_MAX = 70.0;
const OVERLAY_COLORS = ["#114B5F", "#F4A259", "#2A9D8F", "#8E5BA6", "#C0554E", "#4A7FB5", "#7A8C4F", "#B0637A"];

/* 여러 실험의 (v, pH) 배열을 x축 기준으로 병합 → 겹쳐 그리기용 */
function mergeRuns(runs) {
  const map = new Map();
  for (const r of runs) {
    for (const p of r.data || []) {
      if (!map.has(p.v)) map.set(p.v, { v: p.v });
      map.get(p.v)[r.id] = p.pH;
    }
  }
  return [...map.values()].sort((a, b) => a.v - b.v);
}

/* ── pH 계산: 전하 균형식을 로그 이분법으로 풀이 ──
   [Na⁺] + [H⁺] = [OH⁻] + [A⁻],  [A⁻] = Cₐ·Ka/(Ka+[H⁺])   */
function computePH(Ka, Ca, Vb) {
  const Kw = 1e-14;
  const Vt = VA + Vb;
  const CaT = (Ca * VA) / Vt;
  const CNa = (CB * Vb) / Vt;
  const f = (h) => CNa + h - Kw / h - (CaT * Ka) / (Ka + h);
  let lo = 1e-14, hi = 1.0;
  for (let i = 0; i < 120; i++) {
    const mid = Math.sqrt(lo * hi);
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return -Math.log10(Math.sqrt(lo * hi));
}

/* 지시약(페놀프탈레인) 색 */
function flaskColor(pH) {
  if (pH < 8.0) return "#EDF4F6";
  if (pH < 10.0) {
    const t = (pH - 8.0) / 2.0;
    return t < 0.5 ? "#F3C9DE" : "#EC9BC8";
  }
  return "#E06FB4";
}

/* ── 공유 저장소 헬퍼 ── */
async function saveSubmission(rec) {
  const key = "titration:" + String(rec.sid).replace(/[^0-9A-Za-z_-]/g, "");
  const res = await window.storage.set(key, JSON.stringify(rec), true);
  if (!res) throw new Error("저장 실패");
}
async function loadSubmissions() {
  let keys = [];
  try {
    const r = await window.storage.list("titration:", true);
    keys = r?.keys || [];
  } catch { return []; }
  const out = [];
  for (const k of keys) {
    try {
      const r = await window.storage.get(k, true);
      if (r?.value) out.push({ key: k, ...JSON.parse(r.value) });
    } catch { /* 개별 실패 무시 */ }
  }
  out.sort((a, b) => String(a.sid).localeCompare(String(b.sid)));
  return out;
}
async function deleteAll(keys) {
  for (const k of keys) { try { await window.storage.delete(k, true); } catch {} }
}

/* ── 공용 소품 ── */
function Chip({ children, tone = "teal" }) {
  const style = tone === "amber"
    ? { background: T.amber, color: T.ink }
    : { background: T.teal, color: "#fff" };
  return (
    <span className="inline-block rounded-full px-3 py-1 text-xs font-bold tracking-wide" style={style}>
      {children}
    </span>
  );
}
function Card({ children, className = "", style = {} }) {
  return (
    <div className={"rounded-2xl bg-white " + className}
      style={{ border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(16,51,63,0.05)", ...style }}>
      {children}
    </div>
  );
}
function Btn({ children, onClick, tone = "teal", disabled, className = "", small }) {
  const bg = tone === "amber" ? T.amber : tone === "ghost" ? "transparent" : T.teal;
  const fg = tone === "amber" ? T.ink : tone === "ghost" ? T.teal : "#fff";
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-xl font-bold transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${small ? "px-3 py-1.5 text-sm" : "px-5 py-2.5 text-base"} ${className}`}
      style={{ background: bg, color: fg, border: tone === "ghost" ? `1.5px solid ${T.teal}` : "none" }}>
      {children}
    </button>
  );
}

/* ── pH 미터 (시그니처) ── */
function PhMeter({ pH, vb }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: T.ink }}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold tracking-widest" style={{ color: "#7FA3AF" }}>DIGITAL pH METER</span>
        <span className="text-xs" style={{ color: "#7FA3AF" }}>MBL-2026</span>
      </div>
      <div className="mt-1 rounded-lg px-4 py-2 text-right"
        style={{ background: "#071E27", border: "1px solid #1C4654" }}>
        <span className="font-mono text-5xl font-bold tabular-nums" style={{ color: T.amber, textShadow: "0 0 12px rgba(244,162,89,0.45)" }}>
          {pH == null ? "--.--" : pH.toFixed(2)}
        </span>
        <span className="ml-2 font-mono text-sm" style={{ color: "#7FA3AF" }}>pH</span>
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs" style={{ color: "#9FBAC3" }}>
        <span>가한 NaOH: {vb.toFixed(1)} mL</span>
        <span>뷰렛 잔량: {(BURETTE_MAX - vb).toFixed(1)} mL</span>
      </div>
    </div>
  );
}

/* ── 삼각 플라스크 ── */
function Flask({ pH }) {
  const c = pH == null ? "#EDF4F6" : flaskColor(pH);
  return (
    <svg viewBox="0 0 120 140" className="h-36 w-auto" aria-label="삼각 플라스크">
      <path d="M52 8 h16 v34 l30 76 a8 8 0 0 1 -7 11 H29 a8 8 0 0 1 -7 -11 l30 -76 z"
        fill="#FDFEFE" stroke={T.teal} strokeWidth="2.5" />
      <path d="M45 62 l-19.5 56.5 a4 4 0 0 0 3.5 5.5 h62 a4 4 0 0 0 3.5 -5.5 L75 62 z" fill={c} />
      <rect x="50" y="4" width="20" height="6" rx="2" fill={T.teal} />
      <line x1="57" y1="20" x2="57" y2="95" stroke={T.teal} strokeWidth="2" opacity="0.35" />
      <circle cx="57" cy="100" r="5" fill={T.teal} opacity="0.5" />
    </svg>
  );
}

/* ══════════════ 1. 첫 화면 ══════════════ */
function Home({ go }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6"
      style={{ background: `linear-gradient(180deg, ${T.teal} 0%, ${T.ink} 100%)` }}>
      <Chip tone="amber">고등학교 「화학 반응의 세계」 · [12반응01-03]</Chip>
      <h1 className="mt-5 text-center text-4xl font-extrabold text-white sm:text-5xl">가상 중화 적정 실험실</h1>
      <p className="mt-3 text-center text-lg" style={{ color: "#C6D8DE" }}>
        산의 종류와 농도를 바꿔 가며, 데이터로 중화점을 찾아 보세요.
      </p>
      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
        <button onClick={() => go("student-login")}
          className="rounded-3xl bg-white p-8 text-left transition-transform hover:-translate-y-1"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <div className="text-3xl">🧪</div>
          <div className="mt-3 text-2xl font-extrabold" style={{ color: T.teal }}>학생용</div>
          <p className="mt-1 text-sm" style={{ color: T.sub }}>학번·이름을 입력하고 실험을 시작합니다.</p>
        </button>
        <button onClick={() => go("teacher-login")}
          className="rounded-3xl p-8 text-left transition-transform hover:-translate-y-1"
          style={{ background: T.amber, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <div className="text-3xl">📊</div>
          <div className="mt-3 text-2xl font-extrabold" style={{ color: T.ink }}>교사용</div>
          <p className="mt-1 text-sm" style={{ color: "#6B4A22" }}>비밀번호 입력 후 학급 데이터를 확인합니다.</p>
        </button>
      </div>
      <p className="mt-8 text-xs" style={{ color: "#8FAEB8" }}>
        제출된 실험 데이터는 학급(이 앱의 모든 사용자)과 공유됩니다.
      </p>
    </div>
  );
}

/* ══════════════ 2. 학생 로그인 ══════════════ */
function StudentLogin({ go, setStudent }) {
  const [sid, setSid] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    const s = sid.trim(), n = name.trim();
    if (!/^\d{4,6}$/.test(s)) { setErr("학번은 4~6자리 숫자로 입력하세요. (예: 20415)"); return; }
    if (n.length < 2) { setErr("이름을 입력하세요."); return; }
    setStudent({ sid: s, name: n });
    go("lab");
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: T.tealSoft }}>
      <Card className="w-full max-w-md p-8">
        <Chip>학생용</Chip>
        <h2 className="mt-4 text-2xl font-extrabold" style={{ color: T.teal }}>실험 전에 이름을 남겨 주세요</h2>
        <label className="mt-6 block text-sm font-bold" style={{ color: T.ink }}>학번</label>
        <input value={sid} onChange={(e) => setSid(e.target.value)} inputMode="numeric" placeholder="20415"
          className="mt-1 w-full rounded-xl px-4 py-3 text-lg outline-none"
          style={{ border: `1.5px solid ${T.line}`, color: T.ink }} />
        <label className="mt-4 block text-sm font-bold" style={{ color: T.ink }}>이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="김화학"
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-1 w-full rounded-xl px-4 py-3 text-lg outline-none"
          style={{ border: `1.5px solid ${T.line}`, color: T.ink }} />
        {err && <p className="mt-3 text-sm font-bold" style={{ color: "#C0554E" }}>{err}</p>}
        <div className="mt-6 flex gap-3">
          <Btn tone="ghost" onClick={() => go("home")}>← 처음으로</Btn>
          <Btn onClick={submit} className="flex-1">실험실 입장</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════ 3. 학생 실험실 ══════════════ */
function Lab({ go, student }) {
  const [acidId, setAcidId] = useState("hcl");
  const [conc, setConc] = useState(0.1);
  const [vb, setVb] = useState(0);
  const [data, setData] = useState([]);       // {v, pH}
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(null);   // 'ok' | 'err'
  const [saving, setSaving] = useState(false);

  const acid = ACIDS.find((a) => a.id === acidId);
  const curPH = data.length ? data[data.length - 1].pH : null;
  const started = data.length > 0;

  /* 담아 둔 실험들 {id, label, acidId, acidLabel, kind, conc, data, visible, eqGuess} */
  const [runs, setRuns] = useState([]);
  const bankRun = () => {
    setRuns((rs) => [...rs, {
      id: "run" + Date.now(),
      label: `${acid.name} ${conc.toFixed(2)} M`,
      acidId: acid.id, acidLabel: `${acid.name}(${acid.formula})`, kind: acid.kind, conc,
      color: OVERLAY_COLORS[(rs.length % (OVERLAY_COLORS.length - 1)) + 1],
      data, visible: true, eqGuess: "",
    }]);
    setVb(0); setData([]); setSaved(null); // 새 실험 시작
  };
  const toggleRun = (id) => setRuns((rs) => rs.map((r) => r.id === id ? { ...r, visible: !r.visible } : r));
  const removeRun = (id) => setRuns((rs) => rs.filter((r) => r.id !== id));
  const setRunEq = (id, val) => setRuns((rs) => rs.map((r) => r.id === id ? { ...r, eqGuess: val } : r));

  const visibleRuns = runs.filter((r) => r.visible);
  const chartSeries = [
    ...visibleRuns,
    ...(data.length ? [{ id: "cur", label: `현재: ${acid.name} ${conc.toFixed(2)} M`, color: T.teal, data }] : []),
  ];
  const mergedData = mergeRuns(chartSeries);

  const measure = (v) => {
    const raw = computePH(acid.Ka, conc, v);
    const noisy = raw + (Math.random() - 0.5) * 0.04; // 센서 노이즈 ±0.02
    return Math.round(Math.min(14, Math.max(0, noisy)) * 100) / 100;
  };

  const start = () => {
    setData([{ v: 0, pH: measure(0) }]);
    setVb(0); setSaved(null);
  };
  const add = (dv) => {
    const nv = Math.round((vb + dv) * 10) / 10;
    if (nv > BURETTE_MAX) return;
    setVb(nv);
    setData((d) => [...d, { v: nv, pH: measure(nv) }]);
  };
  const reset = () => { setVb(0); setData([]); setSaved(null); };

  const submit = async () => {
    setSaving(true); setSaved(null);
    try {
      await saveSubmission({
        v: 2, sid: student.sid, name: student.name,
        runs: runs.map(({ id, label, acidId: aId, acidLabel, kind, conc: c, data: d, eqGuess }) => ({
          id, label, acidId: aId, acidLabel, kind, conc: c, data: d,
          eqGuess: eqGuess === "" || isNaN(Number(eqGuess)) ? null : Number(eqGuess),
        })),
        reason: reason.trim(), ts: Date.now(),
      });
      setSaved("ok");
    } catch { setSaved("err"); }
    setSaving(false);
  };

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8" style={{ background: T.tealSoft }}>
      {/* 헤더 */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Chip>학생 실험실</Chip>
          <span className="font-bold" style={{ color: T.ink }}>{student.sid} {student.name}</span>
        </div>
        <Btn tone="ghost" small onClick={() => go("home")}>나가기</Btn>
      </div>

      <div className="mx-auto mt-5 grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-5">
        {/* ── 왼쪽: 실험 조건 + 조작 ── */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card className="p-5">
            <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>① 실험 조건</h3>
            <p className="mt-1 text-xs" style={{ color: T.sub }}>
              삼각 플라스크: 산 25.0 mL · 뷰렛: 0.100 M NaOH (고정)
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {ACIDS.map((a) => (
                <button key={a.id} disabled={started}
                  onClick={() => setAcidId(a.id)}
                  className="rounded-xl p-3 text-left transition disabled:opacity-50"
                  style={{
                    border: `2px solid ${acidId === a.id ? T.teal : T.line}`,
                    background: acidId === a.id ? T.tealSoft : "#fff",
                  }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-extrabold" style={{ color: T.ink }}>{a.name}</span>
                    <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                      style={{ background: a.kind === "강산" ? T.teal : T.amber, color: a.kind === "강산" ? "#fff" : T.ink }}>
                      {a.kind}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: T.sub }}>{a.formula} · {a.pKaText}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: T.ink }}>산의 농도</span>
              {CONCS.map((c) => (
                <button key={c} disabled={started} onClick={() => setConc(c)}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-50"
                  style={{
                    border: `2px solid ${conc === c ? T.teal : T.line}`,
                    background: conc === c ? T.teal : "#fff",
                    color: conc === c ? "#fff" : T.ink,
                  }}>
                  {c.toFixed(2)} M
                </button>
              ))}
            </div>
            {started && (
              <p className="mt-2 text-xs" style={{ color: T.sub }}>
                조건을 바꾸려면 <b>다시 실험</b>을 눌러 초기화하세요.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>② 적정하기</h3>
            <div className="mt-3 flex items-center gap-4">
              <Flask pH={curPH} />
              <div className="flex-1">
                <PhMeter pH={curPH} vb={vb} />
              </div>
            </div>
            {!started ? (
              <Btn onClick={start} className="mt-4 w-full">센서 보정 완료 — 측정 시작</Btn>
            ) : (
              <>
                <p className="mt-3 text-sm font-bold" style={{ color: T.ink }}>NaOH 가하기</p>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {[5, 1, 0.5, 0.1].map((dv) => (
                    <Btn key={dv} small tone={dv <= 0.5 ? "amber" : "teal"}
                      disabled={vb + dv > BURETTE_MAX}
                      onClick={() => add(dv)}>
                      +{dv} mL
                    </Btn>
                  ))}
                </div>
                <p className="mt-2 text-xs" style={{ color: T.sub }}>
                  pH가 빠르게 변하기 시작하면 <b style={{ color: T.amberDeep }}>+0.5, +0.1 mL</b>로 촘촘히 측정하세요.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn tone="ghost" small onClick={reset}>다시 실험 (초기화)</Btn>
                  <Btn small tone="amber" disabled={data.length < 3} onClick={bankRun}>
                    곡선 담고 새 실험 →
                  </Btn>
                </div>
                <p className="mt-2 text-xs" style={{ color: T.sub }}>
                  <b style={{ color: T.amberDeep }}>곡선 담기</b>를 누르면 지금 곡선이 그래프에 남고,
                  산·농도를 바꿔 새 실험과 겹쳐 비교할 수 있어요.
                </p>
              </>
            )}
          </Card>
        </div>

        {/* ── 오른쪽: 그래프 + 데이터 + 제출 ── */}
        <div className="flex flex-col gap-5 lg:col-span-3">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>③ 나의 적정 곡선</h3>
              <span className="text-xs font-bold" style={{ color: T.sub }}>
                담은 곡선 {runs.length}개 · 현재 데이터 {data.length}개
              </span>
            </div>
            <div className="mt-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mergedData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                  <CartesianGrid stroke={T.line} vertical={false} />
                  <XAxis type="number" dataKey="v" domain={[0, BURETTE_MAX]}
                    tickCount={15} stroke={T.sub} fontSize={12}
                    label={{ value: "가한 NaOH 부피 (mL)", position: "insideBottom", dy: 12, fontSize: 12, fill: T.sub }} />
                  <YAxis type="number" domain={[0, 14]} tickCount={8} stroke={T.sub} fontSize={12}
                    label={{ value: "pH", angle: -90, position: "insideLeft", dx: 18, fontSize: 12, fill: T.sub }} />
                  <Tooltip formatter={(v) => (v == null ? "" : Number(v).toFixed(2))}
                    labelFormatter={(l) => `NaOH ${l} mL`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {visibleRuns.filter((r) => r.eqGuess !== "" && !isNaN(Number(r.eqGuess))).map((r) => (
                    <ReferenceLine key={"eq" + r.id} x={Number(r.eqGuess)} stroke={r.color}
                      strokeWidth={1.5} strokeDasharray="6 3" />
                  ))}
                  {chartSeries.map((r) => (
                    <Line key={r.id} dataKey={r.id} name={r.label} type="monotone"
                      stroke={r.color} strokeWidth={r.id === "cur" ? 3 : 2}
                      dot={r.id === "cur" ? { r: 2.5, fill: r.color } : false}
                      connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {runs.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-bold" style={{ color: T.sub }}>담은 곡선 — 체크로 표시/숨김</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {runs.map((r) => (
                    <label key={r.id}
                      className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold"
                      style={{ border: `1.5px solid ${r.visible ? r.color : T.line}`, background: r.visible ? "#fff" : T.tealSoft, color: T.ink, opacity: r.visible ? 1 : 0.55 }}>
                      <input type="checkbox" checked={r.visible} onChange={() => toggleRun(r.id)} />
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: r.color }} />
                      {r.label}
                      <button onClick={(e) => { e.preventDefault(); removeRun(r.id); }}
                        className="ml-1 font-extrabold" style={{ color: T.sub }} title="곡선 삭제">×</button>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>④ 실험별로 중화점 찾기 → 한 번에 제출</h3>
            {runs.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: T.sub }}>
                아직 담아 둔 실험이 없어요. 적정을 마친 뒤 <b style={{ color: T.amberDeep }}>곡선 담고 새 실험</b>을
                누르면 실험이 여기에 쌓이고, 실험마다 중화점을 적어 한 번에 제출할 수 있습니다.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {runs.map((r, i) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2"
                    style={{ background: T.tealSoft, border: `1px solid ${T.line}` }}>
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: r.color }} />
                    <span className="text-sm font-bold" style={{ color: T.ink }}>
                      실험 {i + 1} · {r.label}
                      <span className="ml-2 font-normal" style={{ color: T.sub }}>데이터 {r.data.length}개</span>
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <label className="text-xs font-bold" style={{ color: T.ink }}>중화점(mL)</label>
                      <input value={r.eqGuess} onChange={(e) => setRunEq(r.id, e.target.value)}
                        inputMode="decimal" placeholder="예: 25.0"
                        className="w-24 rounded-lg px-2 py-1.5 text-sm outline-none"
                        style={{ border: `1.5px solid ${r.eqGuess !== "" && !isNaN(Number(r.eqGuess)) ? r.color : T.line}`, background: "#fff", color: T.ink }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <label className="text-sm font-bold" style={{ color: T.ink }}>판단 근거 (데이터로 설명)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="예: 실험 1은 24.9→25.1 mL에서 pH가 3.7→10.3으로 급변"
                className="mt-1 w-full rounded-xl px-4 py-2.5 outline-none"
                style={{ border: `1.5px solid ${T.line}`, color: T.ink }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Btn tone="amber" disabled={runs.length === 0 || saving} onClick={submit}>
                {saving ? "제출 중…" : `실험 ${runs.length}개 선생님께 제출`}
              </Btn>
              {runs.length === 0 && <span className="text-xs" style={{ color: T.sub }}>담아 둔 실험이 1개 이상이면 제출할 수 있어요.</span>}
              {started && <span className="text-xs font-bold" style={{ color: T.amberDeep }}>진행 중인 실험도 제출하려면 먼저 '곡선 담고 새 실험'을 누르세요.</span>}
              {saved === "ok" && <span className="text-sm font-bold" style={{ color: "#2A9D8F" }}>✓ 제출 완료! (다시 제출하면 이전 기록을 덮어씁니다)</span>}
              {saved === "err" && <span className="text-sm font-bold" style={{ color: "#C0554E" }}>제출에 실패했어요. 잠시 후 다시 시도하세요.</span>}
            </div>
            <p className="mt-2 text-xs" style={{ color: T.sub }}>
              중화점을 입력하면 그래프에 같은 색 점선으로 표시됩니다. 제출한 데이터(학번·이름 포함)는 교사용 대시보드와 학급 전체에 공유됩니다.
            </p>
          </Card>

          {data.length > 0 && (
            <Card className="p-5">
              <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>측정 기록</h3>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl" style={{ border: `1px solid ${T.line}` }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0" style={{ background: T.teal, color: "#fff" }}>
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">#</th>
                      <th className="px-3 py-2 text-left font-bold">NaOH 부피 (mL)</th>
                      <th className="px-3 py-2 text-left font-bold">pH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((d, i) => (
                      <tr key={i} style={{ background: i % 2 ? T.tealSoft : "#fff", color: T.ink }}>
                        <td className="px-3 py-1.5">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono">{d.v.toFixed(1)}</td>
                        <td className="px-3 py-1.5 font-mono">{d.pH.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ 4. 교사 로그인 ══════════════ */
function TeacherLogin({ go }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pw === "1234") go("dashboard");
    else { setErr(true); setPw(""); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: T.tealSoft }}>
      <Card className="w-full max-w-sm p-8">
        <Chip tone="amber">교사용</Chip>
        <h2 className="mt-4 text-2xl font-extrabold" style={{ color: T.teal }}>대시보드 접속</h2>
        <label className="mt-6 block text-sm font-bold" style={{ color: T.ink }}>비밀번호</label>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••"
          className="mt-1 w-full rounded-xl px-4 py-3 text-lg outline-none"
          style={{ border: `1.5px solid ${err ? "#C0554E" : T.line}`, color: T.ink }} />
        {err && <p className="mt-2 text-sm font-bold" style={{ color: "#C0554E" }}>비밀번호가 일치하지 않습니다.</p>}
        <div className="mt-6 flex gap-3">
          <Btn tone="ghost" onClick={() => go("home")}>← 처음으로</Btn>
          <Btn onClick={submit} className="flex-1">접속</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════ 5. 교사 대시보드 ══════════════ */
function Dashboard({ go }) {
  const [subs, setSubs] = useState(null);   // null = 로딩
  const [sel, setSel] = useState(null);     // 상세 보기 key
  const [overlay, setOverlay] = useState([]); // 비교 선택: 학생 keys
  const [runSel, setRunSel] = useState({}); // {studentKey: [runId, ...]} 학생 내 실험 선택
  const [busy, setBusy] = useState(false);

  /* 구버전(단일 실험)·신버전(runs 배열) 제출을 동일 구조로 정규화 */
  const normalize = (s) => {
    if (Array.isArray(s.runs)) return s;
    return {
      ...s,
      runs: [{
        id: "run1",
        label: `${s.acidLabel || "?"} ${Number(s.conc).toFixed(2)} M`,
        acidLabel: s.acidLabel, kind: s.kind, conc: s.conc,
        data: s.data || [], eqGuess: s.eqGuess ?? null,
      }],
    };
  };

  const refresh = useCallback(async () => {
    setSubs(null);
    const list = (await loadSubmissions()).map(normalize);
    setSubs(list);
    setSel((s) => (s && list.some((x) => x.key === s) ? s : null));
    setOverlay((o) => o.filter((k) => list.some((x) => x.key === k)));
    // 새로 들어온 학생은 모든 실험을 기본 선택
    setRunSel((prev) => {
      const next = { ...prev };
      for (const s of list) {
        const ids = s.runs.map((r) => r.id);
        if (!next[s.key]) next[s.key] = ids;
        else next[s.key] = next[s.key].filter((id) => ids.includes(id));
      }
      return next;
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const clearAll = async () => {
    if (!window.confirm("모든 학생 제출 데이터를 삭제할까요? 되돌릴 수 없습니다.")) return;
    setBusy(true);
    await deleteAll((subs || []).map((s) => s.key));
    setBusy(false);
    refresh();
  };

  const removeOne = async (s) => {
    if (!window.confirm(`${s.sid} ${s.name} 학생의 데이터를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    try { await window.storage.delete(s.key, true); } catch {}
    setBusy(false);
    refresh();
  };

  const toggleRunSel = (studentKey, runId) => {
    setRunSel((prev) => {
      const cur = prev[studentKey] || [];
      return {
        ...prev,
        [studentKey]: cur.includes(runId) ? cur.filter((i) => i !== runId) : [...cur, runId],
      };
    });
  };

  const detail = subs?.find((s) => s.key === sel);
  const eqTheory = (run) => (Number(run.conc) * VA) / CB;
  const selectedRunsOf = (s) => s.runs.filter((r) => (runSel[s.key] || []).includes(r.id));

  /* 중화점 판정: 이론값과 ±1.0 mL 이내면 적절, 벗어나면 오판 표시 */
  const EQ_TOL = 1.0;
  const judgeEq = (run) => {
    if (run.eqGuess == null || isNaN(Number(run.eqGuess))) return null;
    const dev = Number(run.eqGuess) - eqTheory(run);
    return { dev, ok: Math.abs(dev) <= EQ_TOL };
  };
  const wrongCount = (s) => s.runs.reduce((n, r) => {
    const j = judgeEq(r);
    return n + (j && !j.ok ? 1 : 0);
  }, 0);

  /* 상세 차트: 선택된 학생의 선택된 실험들 */
  const detailRuns = detail ? selectedRunsOf(detail).map((r, i) => ({
    ...r, uid: detail.key + "_" + r.id, color: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
  })) : [];
  const detailMerged = mergeRuns(detailRuns.map((r) => ({ id: r.uid, data: r.data })));

  /* 비교 차트: 체크된 학생들의 (각자 선택된) 실험들 */
  const compareRuns = (subs || [])
    .filter((s) => overlay.includes(s.key))
    .flatMap((s) => selectedRunsOf(s).map((r) => ({
      ...r, uid: s.key + "_" + r.id, owner: s.name,
    })))
    .map((r, i) => ({ ...r, color: OVERLAY_COLORS[i % OVERLAY_COLORS.length] }));
  const compareMerged = mergeRuns(compareRuns.map((r) => ({ id: r.uid, data: r.data })));

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8" style={{ background: T.tealSoft }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Chip tone="amber">교사용 대시보드</Chip>
          <span className="text-sm font-bold" style={{ color: T.sub }}>
            제출 {subs ? subs.length : "…"}명 · 실험 {subs ? subs.reduce((a, s) => a + s.runs.length, 0) : "…"}건
          </span>
        </div>
        <div className="flex gap-2">
          <Btn small tone="ghost" onClick={refresh}>새로고침</Btn>
          <Btn small tone="ghost" onClick={clearAll} disabled={busy || !subs?.length}>전체 삭제</Btn>
          <Btn small onClick={() => go("home")}>나가기</Btn>
        </div>
      </div>

      <div className="mx-auto mt-5 grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-5">
        {/* 학생 목록 */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>학생별 수집 데이터</h3>
          {subs === null ? (
            <p className="mt-4 text-sm" style={{ color: T.sub }}>불러오는 중…</p>
          ) : subs.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: T.sub }}>
              아직 제출된 데이터가 없습니다. 학생이 제출하면 <b>새로고침</b>으로 확인하세요.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl" style={{ border: `1px solid ${T.line}` }}>
              <table className="w-full text-sm" style={{ minWidth: 380 }}>
                <thead style={{ background: T.teal, color: "#fff" }}>
                  <tr>
                    <th className="px-2 py-2 text-left font-bold">비교</th>
                    <th className="px-3 py-2 text-left font-bold">학번</th>
                    <th className="px-3 py-2 text-left font-bold">이름</th>
                    <th className="px-3 py-2 text-right font-bold">실험 수</th>
                    <th className="px-3 py-2 text-left font-bold">제출 시각</th>
                    <th className="px-2 py-2 text-center font-bold">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s, i) => {
                    const active = sel === s.key;
                    return (
                      <tr key={s.key} onClick={() => setSel(active ? null : s.key)}
                        className="cursor-pointer"
                        style={{ background: active ? "#FBEBD8" : i % 2 ? T.tealSoft : "#fff", color: T.ink }}>
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={overlay.includes(s.key)}
                            onChange={(e) => setOverlay((o) => e.target.checked ? [...o, s.key] : o.filter((k) => k !== s.key))} />
                        </td>
                        <td className="px-3 py-1.5 font-mono">{s.sid}</td>
                        <td className="px-3 py-1.5 font-bold">{s.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {s.runs.length}개
                          {wrongCount(s) > 0 && (
                            <span className="ml-1 rounded-full px-1.5 py-0.5 text-xs font-bold"
                              style={{ background: "#F9DDDA", color: "#B23E35" }} title="중화점 오판 실험 수">
                              ⚠{wrongCount(s)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs" style={{ color: T.sub }}>
                          {new Date(s.ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => removeOne(s)} disabled={busy} title="이 학생 데이터 삭제"
                            className="rounded-lg px-2 py-1 text-xs font-bold disabled:opacity-40"
                            style={{ background: "#F9E3E1", color: "#C0554E", border: "1px solid #E8C2BE" }}>
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs" style={{ color: T.sub }}>
            행을 클릭하면 그 학생의 실험별 곡선을, <b>비교</b>에 체크하면 학생 간 곡선을 겹쳐 볼 수 있습니다.
            오른쪽에서 학생 안의 실험도 골라 볼 수 있어요.
          </p>
        </Card>

        {/* 학생 상세: 실험 선택 + 곡선 */}
        <Card className="p-5 lg:col-span-3">
          <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>학생 상세 — 실험별 적정 곡선</h3>
          {!detail ? (
            <p className="mt-4 text-sm" style={{ color: T.sub }}>왼쪽 표에서 학생을 선택하세요.</p>
          ) : (
            <>
              <p className="mt-1 text-sm font-bold" style={{ color: T.ink }}>
                {detail.sid} {detail.name} · 실험 {detail.runs.length}개 중 {detailRuns.length}개 표시
              </p>
              {/* 실험 선택 체크박스 */}
              <div className="mt-2 flex flex-col gap-1.5">
                {detail.runs.map((r, i) => {
                  const checked = (runSel[detail.key] || []).includes(r.id);
                  const shown = detailRuns.find((d) => d.id === r.id);
                  const j = judgeEq(r);
                  return (
                    <label key={r.id} className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                      style={{
                        background: j && !j.ok ? "#FDF1F0" : checked ? "#fff" : T.tealSoft,
                        border: `1px solid ${j && !j.ok ? "#E0837B" : checked && shown ? shown.color : T.line}`,
                        opacity: checked ? 1 : 0.55,
                      }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleRunSel(detail.key, r.id)} />
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: shown ? shown.color : T.line }} />
                      <span className="font-bold" style={{ color: T.ink }}>실험 {i + 1} · {r.label}</span>
                      <span style={{ color: T.sub }}>데이터 {r.data?.length ?? 0}개</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-xs" style={{ color: T.ink }}>
                          학생 중화점 <b style={{ color: T.amberDeep }}>{r.eqGuess == null ? "—" : `${Number(r.eqGuess).toFixed(1)} mL`}</b>
                          {" · "}이론값 {eqTheory(r).toFixed(1)} mL
                        </span>
                        {j === null ? (
                          <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                            style={{ background: T.tealSoft, color: T.sub, border: `1px solid ${T.line}` }}>
                            미입력
                          </span>
                        ) : j.ok ? (
                          <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                            style={{ background: "#E3F3EF", color: "#1F7A6D", border: "1px solid #9ED4C8" }}>
                            ✓ 적절
                          </span>
                        ) : (
                          <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                            style={{ background: "#F9DDDA", color: "#B23E35", border: "1px solid #E0837B" }}>
                            ⚠ 오차 {j.dev > 0 ? "+" : ""}{j.dev.toFixed(1)} mL
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detailMerged} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
                    <CartesianGrid stroke={T.line} vertical={false} />
                    <XAxis type="number" dataKey="v" domain={[0, BURETTE_MAX]} tickCount={8} stroke={T.sub} fontSize={11} />
                    <YAxis type="number" domain={[0, 14]} tickCount={8} stroke={T.sub} fontSize={11} />
                    <Tooltip formatter={(v) => (v == null ? "" : Number(v).toFixed(2))} labelFormatter={(l) => `NaOH ${l} mL`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {detailRuns.filter((r) => r.eqGuess != null).map((r) => (
                      <ReferenceLine key={"eq" + r.uid} x={Number(r.eqGuess)} stroke={r.color}
                        strokeWidth={1.5} strokeDasharray="6 3" />
                    ))}
                    {detailRuns.map((r) => (
                      <Line key={r.uid} dataKey={r.uid} name={r.label} type="monotone"
                        stroke={r.color} strokeWidth={2.5} dot={{ r: 2 }}
                        connectNulls isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-xs" style={{ color: T.sub }}>
                점선: 학생이 판단한 중화점 (곡선과 같은 색) · 판정 기준: 이론값과 ±1.0 mL 이내면 <b style={{ color: "#1F7A6D" }}>✓ 적절</b>,
                벗어나면 <b style={{ color: "#B23E35" }}>⚠ 오차</b>로 표시됩니다.
              </p>
              <div className="mt-2 rounded-xl p-3 text-sm" style={{ background: T.tealSoft, color: T.ink }}>
                <b style={{ color: T.amberDeep }}>판단 근거</b> — {detail.reason || "(작성하지 않음)"}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* 학생 간 곡선 비교 */}
      {compareRuns.length > 0 && (
        <Card className="mx-auto mt-5 max-w-6xl p-5">
          <h3 className="text-lg font-extrabold" style={{ color: T.teal }}>
            학생 간 곡선 비교 <span className="text-sm font-bold" style={{ color: T.sub }}>(실험 {compareRuns.length}개)</span>
          </h3>
          <p className="mt-1 text-xs" style={{ color: T.sub }}>
            체크한 학생들의 <b>선택된 실험</b>만 겹쳐 그립니다. 학생 상세에서 실험을 고르면 여기에도 반영됩니다.
          </p>
          <div className="mt-2 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={compareMerged} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                <CartesianGrid stroke={T.line} vertical={false} />
                <XAxis type="number" dataKey="v" domain={[0, BURETTE_MAX]} tickCount={15} stroke={T.sub} fontSize={12}
                  label={{ value: "가한 NaOH 부피 (mL)", position: "insideBottom", dy: 12, fontSize: 12, fill: T.sub }} />
                <YAxis type="number" domain={[0, 14]} tickCount={8} stroke={T.sub} fontSize={12} />
                <Tooltip formatter={(v) => (v == null ? "" : Number(v).toFixed(2))} labelFormatter={(l) => `NaOH ${l} mL`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {compareRuns.map((r) => (
                  <Line key={r.uid} dataKey={r.uid} type="monotone"
                    name={`${r.owner} · ${r.label}`}
                    stroke={r.color} strokeWidth={2.5} dot={false}
                    connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ══════════════ 루트 ══════════════ */
export default function VirtualTitrationLab() {
  const [view, setView] = useState("home");
  const [student, setStudent] = useState(null);
  const go = (v) => setView(v);
  return (
    <div style={{ fontFamily: "'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" }}>
      {view === "home" && <Home go={go} />}
      {view === "student-login" && <StudentLogin go={go} setStudent={setStudent} />}
      {view === "lab" && student && <Lab go={go} student={student} />}
      {view === "teacher-login" && <TeacherLogin go={go} />}
      {view === "dashboard" && <Dashboard go={go} />}
    </div>
  );
}
