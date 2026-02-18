import { useState, useEffect, useCallback } from "react";

const API_BASE = "http://localhost:8000";

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      "#0a0e1a",
  surface: "#111827",
  card:    "#161d2e",
  border:  "#1e2d45",
  accent:  "#00e5ff",
  green:   "#00ff9d",
  amber:   "#ffb800",
  red:     "#ff4466",
  muted:   "#4a6080",
  text:    "#c8d8f0",
  white:   "#f0f6ff",
};

// ── tiny helpers ──────────────────────────────────────────────────────────────
const scoreColor = (s) => s >= 80 ? C.green : s >= 60 ? C.amber : C.red;
const sevColor   = (s) => ({ high: C.red, medium: C.amber, low: C.green }[s] ?? C.muted);
const statusColor= (s) => s === "passed" ? C.green : s === "failed" ? C.red : C.muted;

function api(path, opts = {}) {
  return fetch(API_BASE + path, opts).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

// ── global styles injected once ───────────────────────────────────────────────
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 15px; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'Syne', sans-serif; min-height: 100vh; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${C.surface}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }

  @keyframes fadeUp   { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse    { 0%,100% { opacity:1; } 50% { opacity:.4; } }
  @keyframes spin     { to { transform: rotate(360deg); } }
  @keyframes scanline { 0% { top:-20%; } 100% { top:110%; } }

  .fade-up { animation: fadeUp .45s ease both; }
  .fade-up-2 { animation: fadeUp .45s .1s ease both; }
  .fade-up-3 { animation: fadeUp .45s .2s ease both; }
  .pulse { animation: pulse 1.8s infinite; }
  .spin  { animation: spin  1s linear infinite; display:inline-block; }

  button { cursor: pointer; border: none; font-family: inherit; }
  input, select { font-family: 'Space Mono', monospace; }

  .btn {
    padding: .55rem 1.2rem; border-radius: 6px; font-size: .82rem;
    font-weight: 700; letter-spacing: .06em; transition: all .18s;
  }
  .btn-primary {
    background: ${C.accent}18; color: ${C.accent};
    border: 1px solid ${C.accent}55;
  }
  .btn-primary:hover { background: ${C.accent}30; box-shadow: 0 0 16px ${C.accent}44; }
  .btn-danger  {
    background: ${C.red}18; color: ${C.red};
    border: 1px solid ${C.red}44;
  }
  .btn-danger:hover { background: ${C.red}30; }
  .btn-ghost  {
    background: transparent; color: ${C.muted};
    border: 1px solid ${C.border};
  }
  .btn-ghost:hover { color: ${C.text}; border-color: ${C.muted}; }

  .tag {
    display:inline-block; padding:.18rem .55rem; border-radius:4px;
    font-size:.72rem; font-weight:700; letter-spacing:.05em;
    font-family:'Space Mono',monospace;
  }

  .mono { font-family: 'Space Mono', monospace; }
`;

// ══════════════════════════════════════════════════════════════════════════════
// SCORE RING
// ══════════════════════════════════════════════════════════════════════════════
function ScoreRing({ score, size = 110 }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const fill = ((score ?? 0) / 100) * circ;
  const color = scoreColor(score ?? 0);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={8}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={8} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ - fill}
        style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 8px ${color}88)` }}/>
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: size*.22, fontWeight: 800,
                 fontFamily:"'Syne',sans-serif", transform:"rotate(90deg)",
                 transformOrigin:"center" }}>
        {score ?? "—"}
      </text>
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MINI BAR
// ══════════════════════════════════════════════════════════════════════════════
function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height:6, background: C.border, borderRadius:3, overflow:"hidden", flex:1 }}>
      <div style={{ width:`${pct}%`, height:"100%", background: color,
                    borderRadius:3, transition:"width .6s ease",
                    boxShadow:`0 0 6px ${color}88` }}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CARD
// ══════════════════════════════════════════════════════════════════════════════
function Card({ children, style = {}, className = "" }) {
  return (
    <div className={className} style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "1.4rem", ...style
    }}>{children}</div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD ZONE
// ══════════════════════════════════════════════════════════════════════════════
function UploadZone({ onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);

  const upload = async (file) => {
    if (!file || !file.name.endsWith(".csv")) {
      setMsg({ ok: false, text: "Only CSV files are supported." });
      return;
    }
    setUploading(true); setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const ds = await api("/datasets/upload", { method:"POST", body:fd });
      setMsg({ ok:true, text:`✓ "${ds.name}" uploaded — ${ds.total_rows} rows` });
      onUploaded(ds);
    } catch(e) {
    // Пробуем получить детальное сообщение от API
    try {
        const errData = await fetch(API_BASE + "/datasets/upload", {
            method: "POST",
            body: fd
        }).then(r => r.json());

        if (errData.detail && typeof errData.detail === "object") {
            setMsg({
                ok: false,
                text: errData.detail.error || "Upload failed",
                details: errData.detail
            });
        } else {
            setMsg({ ok: false, text: e.message });
        }
    } catch {
        setMsg({ ok: false, text: "Upload failed: " + e.message });
    }
} finally { setUploading(false); }
  };

  return (
    <Card style={{ textAlign:"center", padding:"2.2rem" }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
        style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`,
          borderRadius: 10, padding:"2rem 1rem",
          transition:"border-color .2s",
          background: dragging ? `${C.accent}08` : "transparent"
        }}>
        <div style={{ fontSize:"2.4rem", marginBottom:".6rem" }}>📂</div>
        <p style={{ color: C.text, fontWeight:600, marginBottom:".4rem" }}>
          Drop a CSV file here
        </p>
        <p style={{ color: C.muted, fontSize:".82rem", marginBottom:"1rem" }}>
          or click to browse
        </p>
        <label style={{ cursor:"pointer" }}>
          <span className="btn btn-primary">
            {uploading ? <span className="spin">⟳</span> : "Choose File"}
          </span>
          <input type="file" accept=".csv" style={{ display:"none" }}
            onChange={e => upload(e.target.files[0])}/>
        </label>
      </div>
      {msg && (
    <div style={{ marginTop: ".9rem", textAlign: "left" }}>
        <p style={{
            fontSize: ".82rem",
            color: msg.ok ? C.green : C.red,
            fontFamily: "'Space Mono', monospace",
            marginBottom: msg.details ? ".5rem" : 0
        }}>
            {msg.ok ? "✓" : "✗"} {msg.text}
        </p>

        {msg.details && (
            <div style={{
                background: `${C.red}10`,
                border: `1px solid ${C.red}33`,
                borderRadius: 8,
                padding: ".75rem",
                fontSize: ".78rem"
            }}>
                {msg.details.reason && (
                    <p style={{ color: C.amber, marginBottom: ".4rem" }}>
                        ⚠ {msg.details.reason}
                    </p>
                )}
                {msg.details.explanation && (
                    <p style={{ color: C.text, marginBottom: ".4rem" }}>
                        {msg.details.explanation}
                    </p>
                )}
                {msg.details.found_issues?.length > 0 && (
                    <div style={{ marginBottom: ".4rem" }}>
                        <p style={{ color: C.muted, marginBottom: ".3rem" }}>
                            Found issues:
                        </p>
                        {msg.details.found_issues.map((issue, i) => (
                            <p key={i} style={{
                                color: C.red,
                                fontFamily: "'Space Mono', monospace",
                                fontSize: ".75rem"
                            }}>
                                • {issue}
                            </p>
                        ))}
                    </div>
                )}
                {msg.details.how_to_fix && (
                    <p style={{ color: C.green, marginTop: ".4rem" }}>
                        💡 {msg.details.how_to_fix}
                    </p>
                )}
            </div>
        )}
    </div>
)}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DATASET LIST
// ══════════════════════════════════════════════════════════════════════════════
function DatasetList({ datasets, selected, onSelect, onDelete }) {
  const [deleting, setDeleting] = useState(null);

  const handleDelete = async (ds, e) => {
    e.stopPropagation(); // Чтобы не выбирался датасет при клике на delete

    if (!window.confirm(`Delete "${ds.name}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(ds.id);
    try {
      await api(`/datasets/${ds.id}`, { method: "DELETE" });
      onDelete(ds.id);
    } catch (e) {
      const msg = e.message.includes("version")
        ? "Cannot delete: child versions exist. Delete them first."
        : "Delete failed: " + e.message;
      alert(msg);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <h3 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                   textTransform:"uppercase", marginBottom:"1rem" }}>Datasets</h3>
      {datasets.length === 0 && (
        <p style={{ color:C.muted, fontSize:".85rem" }}>No datasets yet. Upload a CSV!</p>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
        {datasets.map(ds => (
          <div key={ds.id} onClick={() => onSelect(ds)}
            style={{
              padding:".75rem 1rem", borderRadius:8, cursor:"pointer",
              border: `1px solid ${selected?.id===ds.id ? C.accent+"66" : C.border}`,
              background: selected?.id===ds.id ? `${C.accent}0a` : "transparent",
              transition:"all .15s",
              display: "flex", alignItems: "center", gap: ".75rem"
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap: ".5rem" }}>
    <span style={{
      fontWeight:600,
      fontSize:".88rem",
      color:C.white,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      flex: 1,
      minWidth: 0
    }}>
      {ds.name}
    </span>
                <span className="tag" style={{ background:`${C.accent}15`, color:C.accent }}>
                  v{ds.version}
                </span>
              </div>
              <div style={{ display:"flex", gap:"1rem", marginTop:".35rem" }}>
                <span style={{ fontSize:".74rem", color:C.muted, fontFamily:"'Space Mono',monospace" }}>
                  {ds.total_rows ?? "?"} rows
                </span>
                <span style={{ fontSize:".74rem", color:C.muted, fontFamily:"'Space Mono',monospace" }}>
                  {ds.total_columns ?? "?"} cols
                </span>
              </div>
            </div>
            <button
  className="btn btn-danger"
  onClick={(e) => handleDelete(ds, e)}
  disabled={deleting === ds.id}
  style={{
    padding: ".35rem .65rem",
    fontSize: ".75rem",
    flexShrink: 0,  // Кнопка не сжимается
    minWidth: "32px" // Минимальная ширина
  }}
>
              {deleting === ds.id ? <span className="spin">⟳</span> : "✕"}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE PANEL
// ══════════════════════════════════════════════════════════════════════════════
function ProfilePanel({ dataset }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]     = useState("overview");

  const runProfile = async () => {
    setLoading(true);
    try { setData(await api(`/datasets/${dataset.id}/profile`, { method:"POST" })); }
    catch(e) { alert("Profile error: " + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setData(null); setTab("overview");
    api(`/datasets/${dataset.id}/profile`).then(setData).catch(() => {});
  }, [dataset.id]);

  const profile   = data?.profile ?? data?.metrics?.profile;
  const anomalies = data?.anomalies ?? data?.metrics?.anomalies;
  const score     = data?.quality_score;
  const issues    = data?.issues ?? [];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
        <h2 style={{ fontSize:"1.15rem", fontWeight:800, color:C.white, flex:1 }}>
          {dataset.name}
        </h2>
        <button className="btn btn-primary" onClick={runProfile} disabled={loading}>
          {loading ? <><span className="spin">⟳</span> Analyzing…</> : "▶ Run Analysis"}
        </button>
      </div>

      {!data && !loading && (
        <Card style={{ textAlign:"center", padding:"2.5rem", color:C.muted }}>
          <p style={{ fontSize:"1.5rem", marginBottom:".5rem" }}>🔬</p>
          <p>Click <strong style={{color:C.accent}}>Run Analysis</strong> to profile this dataset.</p>
        </Card>
      )}

      {loading && (
        <Card style={{ textAlign:"center", padding:"2.5rem" }}>
          <p className="pulse" style={{ color:C.accent, fontFamily:"'Space Mono',monospace" }}>
            Analyzing dataset…
          </p>
        </Card>
      )}

      {data && profile && (
        <>
          {/* Score + stats */}
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:"1rem" }}>
            <Card style={{ display:"flex", flexDirection:"column", alignItems:"center",
                           justifyContent:"center", gap:".5rem", minWidth:150 }}>
              <ScoreRing score={score}/>
              <p style={{ fontSize:".75rem", color:C.muted, textTransform:"uppercase",
                          letterSpacing:".1em" }}>Quality Score</p>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".75rem" }}>
              {[
                { label:"Total Rows",   val: profile.total_rows,              icon:"📋" },
                { label:"Columns",      val: profile.total_columns,           icon:"🗂" },
                { label:"Duplicates",   val: profile.duplicates,              icon:"🔁" },
                { label:"Anomalies",    val: anomalies?.anomaly_count ?? 0,   icon:"⚠️" },
              ].map(({ label, val, icon }) => (
                <Card key={label} style={{ padding:"1rem" }}>
                  <div style={{ fontSize:"1.3rem", marginBottom:".3rem" }}>{icon}</div>
                  <div style={{ fontSize:"1.4rem", fontWeight:800, color:C.white,
                                fontFamily:"'Space Mono',monospace" }}>{val}</div>
                  <div style={{ fontSize:".73rem", color:C.muted, textTransform:"uppercase",
                                letterSpacing:".08em" }}>{label}</div>
                </Card>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", gap:".5rem", borderBottom:`1px solid ${C.border}`,
                        paddingBottom:".5rem" }}>
            {["overview","missing","numeric","issues"].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="btn" style={{
                  padding:".35rem .85rem", fontSize:".78rem",
                  background: tab===t ? `${C.accent}18` : "transparent",
                  color: tab===t ? C.accent : C.muted,
                  border: `1px solid ${tab===t ? C.accent+"55" : "transparent"}`
                }}>
                {t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {tab === "overview" && (
            <Card className="fade-up">
              <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:"1rem" }}>Columns</h4>
              <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                {profile.columns?.map(col => (
                  <div key={col} style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
                    <span style={{ minWidth:130, fontFamily:"'Space Mono',monospace",
                                   fontSize:".82rem", color:C.white }}>{col}</span>
                    <span className="tag" style={{ background:`${C.muted}22`, color:C.muted,
                                                   minWidth:70, textAlign:"center" }}>
                      {profile.dtypes?.[col] ?? "?"}
                    </span>
                    <MiniBar value={profile.missing_percentage?.[col] ?? 0}
                             max={100} color={C.amber}/>
                    <span style={{ minWidth:45, fontSize:".75rem", color:C.muted,
                                   fontFamily:"'Space Mono',monospace", textAlign:"right" }}>
                      {profile.missing_percentage?.[col] ?? 0}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Missing tab */}
          {tab === "missing" && (
            <Card className="fade-up">
              <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:"1rem" }}>Missing Values</h4>
              {Object.entries(profile.missing_percentage ?? {}).map(([col, pct]) => (
                <div key={col} style={{ marginBottom:".75rem" }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                                marginBottom:".3rem" }}>
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:".82rem" }}>{col}</span>
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:".82rem",
                                   color: pct > 20 ? C.red : pct > 5 ? C.amber : C.green }}>
                      {pct}%
                    </span>
                  </div>
                  <MiniBar value={pct} max={100}
                           color={pct > 20 ? C.red : pct > 5 ? C.amber : C.green}/>
                </div>
              ))}
            </Card>
          )}

          {/* Numeric tab */}
          {tab === "numeric" && (
            <Card className="fade-up" style={{ overflowX:"auto" }}>
              <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:"1rem" }}>Numeric Statistics</h4>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".82rem" }}>
                <thead>
                  <tr>
                    {["Column","Min","Max","Mean","Median","Std"].map(h => (
                      <th key={h} style={{ textAlign:"left", color:C.muted,
                                          paddingBottom:".5rem", fontWeight:600,
                                          fontSize:".73rem", letterSpacing:".08em",
                                          textTransform:"uppercase",
                                          borderBottom:`1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(profile.numeric_stats ?? {}).map(([col, s]) => (
                    <tr key={col} style={{ borderBottom:`1px solid ${C.border}22` }}>
                      <td style={{ padding:".5rem 0", fontFamily:"'Space Mono',monospace",
                                   color:C.white }}>{col}</td>
                      {["min","max","mean","median","std"].map(k => (
                        <td key={k} style={{ padding:".5rem .5rem",
                                             fontFamily:"'Space Mono',monospace",
                                             color:C.text }}>{s[k] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Issues tab */}
          {tab === "issues" && (
            <Card className="fade-up">
              <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:"1rem" }}>
                Issues ({issues.length})
              </h4>
              {issues.length === 0 && (
                <p style={{ color:C.green, fontFamily:"'Space Mono',monospace",
                            fontSize:".85rem" }}>✓ No issues detected</p>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
                {issues.map((iss, i) => (
                  <div key={i} style={{
                    padding:".85rem 1rem", borderRadius:8,
                    border:`1px solid ${sevColor(iss.severity)}33`,
                    background:`${sevColor(iss.severity)}08`
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:".6rem",
                                  marginBottom:".3rem" }}>
                      <span className="tag" style={{
                        background:`${sevColor(iss.severity)}22`,
                        color: sevColor(iss.severity)
                      }}>{iss.severity?.toUpperCase()}</span>
                      <span style={{ fontFamily:"'Space Mono',monospace", fontSize:".8rem",
                                     color:C.muted }}>{iss.issue_type}</span>
                      {iss.column_name && (
                        <span style={{ fontFamily:"'Space Mono',monospace", fontSize:".8rem",
                                       color:C.accent }}>· {iss.column_name}</span>
                      )}
                    </div>
                    <p style={{ fontSize:".83rem", color:C.text }}>{iss.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AI PANEL
// ══════════════════════════════════════════════════════════════════════════════
function AIPanel({ dataset }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true); setResult(null);
    try { setResult(await api(`/datasets/${dataset.id}/ai-analyze`, { method:"POST" })); }
    catch(e) { alert("AI error: " + e.message); }
    finally { setLoading(false); }
  };

  const ai = result?.ai_analysis;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
        <h2 style={{ flex:1, fontSize:"1.15rem", fontWeight:800, color:C.white }}>
          🤖 AI Data Steward
        </h2>
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? <><span className="spin">⟳</span> Thinking…</> : "✦ Analyze with AI"}
        </button>
      </div>

      {loading && (
        <Card style={{ textAlign:"center", padding:"2.5rem", position:"relative",
                       overflow:"hidden" }}>
          <div style={{
            position:"absolute", left:0, right:0, height:"2px",
            background:`linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
            animation:"scanline 2s linear infinite"
          }}/>
          <p className="pulse" style={{ color:C.accent, fontFamily:"'Space Mono',monospace" }}>
            Llama 3.3 is analyzing your dataset…
          </p>
        </Card>
      )}

      {!result && !loading && (
        <Card style={{ textAlign:"center", padding:"2.5rem", color:C.muted }}>
          <p style={{ fontSize:"1.5rem", marginBottom:".5rem" }}>✦</p>
          <p>Run AI analysis to get insights and recommendations.</p>
          <p style={{ fontSize:".78rem", marginTop:".4rem" }}>Powered by Groq · Llama 3.3 70B</p>
        </Card>
      )}

      {ai && (
        <>
          {/* Summary */}
          <Card className="fade-up" style={{
            borderColor:`${C.accent}44`,
            background:`linear-gradient(135deg, ${C.card}, ${C.accent}08)`
          }}>
            <div style={{ display:"flex", gap:".75rem", alignItems:"flex-start" }}>
              <span style={{ fontSize:"1.4rem" }}>✦</span>
              <div>
                <h4 style={{ color:C.accent, fontSize:".78rem", letterSpacing:".1em",
                             textTransform:"uppercase", marginBottom:".5rem" }}>Summary</h4>
                <p style={{ color:C.text, lineHeight:1.6, fontSize:".9rem" }}>{ai.summary}</p>
              </div>
            </div>
          </Card>

          {/* ML Readiness */}
          <Card className="fade-up-2">
            <h4 style={{ color:C.muted, fontSize:".78rem", letterSpacing:".1em",
                         textTransform:"uppercase", marginBottom:".6rem" }}>ML Readiness</h4>
            <p style={{ color:C.text, fontSize:".88rem", lineHeight:1.5 }}>{ai.ml_readiness}</p>
            {ai.ml_risks?.length > 0 && (
              <div style={{ marginTop:".75rem", display:"flex", flexDirection:"column", gap:".4rem" }}>
                {ai.ml_risks.map((r, i) => (
                  <div key={i} style={{ display:"flex", gap:".6rem", alignItems:"flex-start" }}>
                    <span style={{ color:C.amber, marginTop:".1rem" }}>⚠</span>
                    <span style={{ fontSize:".83rem", color:C.text }}>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Critical Problems & Recommendations */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
            <Card className="fade-up-3">
              <h4 style={{ color:C.red, fontSize:".78rem", letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:".75rem" }}>
                Critical Problems
              </h4>
              <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                {ai.critical_problems?.map((p, i) => (
                  <div key={i} style={{ display:"flex", gap:".5rem" }}>
                    <span style={{ color:C.red }}>✗</span>
                    <span style={{ fontSize:".83rem", color:C.text }}>{p}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="fade-up-3">
              <h4 style={{ color:C.green, fontSize:".78rem", letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:".75rem" }}>
                Recommendations
              </h4>
              <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                {ai.recommendations?.map((r, i) => (
                  <div key={i} style={{ display:"flex", gap:".5rem" }}>
                    <span style={{ color:C.green }}>→</span>
                    <span style={{ fontSize:".83rem", color:C.text }}>{r}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Suggested Rules */}
          {ai.suggested_rules?.length > 0 && (
            <Card className="fade-up">
              <h4 style={{ color:C.muted, fontSize:".78rem", letterSpacing:".1em",
                           textTransform:"uppercase", marginBottom:".75rem" }}>
                Suggested Validation Rules
              </h4>
              <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                {ai.suggested_rules.map((r, i) => (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap:".75rem",
                    padding:".6rem .9rem", borderRadius:7,
                    background:`${C.border}44`, border:`1px solid ${C.border}`
                  }}>
                    <span className="tag" style={{ background:`${C.accent}15`, color:C.accent }}>
                      {r.column}
                    </span>
                    <span className="tag" style={{ background:`${C.amber}15`, color:C.amber }}>
                      {r.rule}
                    </span>
                    <span style={{ fontSize:".8rem", color:C.muted, flex:1 }}>{r.reason}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RULES PANEL
// ══════════════════════════════════════════════════════════════════════════════
function RulesPanel({ dataset }) {
  const [rules, setRules]     = useState([]);
  const [form,  setForm]      = useState({ column_name:"", rule_type:"range", parameters:{} });
  const [paramStr, setParamStr] = useState('{"min":0,"max":100}');
  const [valResult, setValResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const r = await api(`/datasets/${dataset.id}/rules`);
      setRules(r.rules ?? []);
    } catch {}
  }, [dataset.id]);

  useEffect(() => { loadRules(); setValResult(null); }, [loadRules]);

  const addRule = async () => {
    let params = {};
    try { params = JSON.parse(paramStr); } catch {
      alert("Parameters must be valid JSON"); return;
    }
    try {
      await api(`/datasets/${dataset.id}/rules`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ...form, parameters: params })
      });
      loadRules();
      setForm({ column_name:"", rule_type:"range", parameters:{} });
      setParamStr('{"min":0,"max":100}');
    } catch(e) { alert("Add rule error: " + e.message); }
  };

  const deleteRule = async (ruleId) => {
    try {
      await api(`/datasets/${dataset.id}/rules/${ruleId}`, { method:"DELETE" });
      loadRules();
    } catch(e) { alert("Delete error: " + e.message); }
  };

  const validate = async () => {
    setLoading(true); setValResult(null);
    try { setValResult(await api(`/datasets/${dataset.id}/validate`, { method:"POST" })); }
    catch(e) { alert("Validation error: " + e.message); }
    finally { setLoading(false); }
  };

  const RULE_TEMPLATES = {
    range: '{"min":0,"max":100}',
    not_null: '{}',
    unique: '{}',
    regex: '{"pattern":"^[\\\\w.-]+@[\\\\w.-]+\\\\.\\\\w+$"}',
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
        <h2 style={{ flex:1, fontSize:"1.15rem", fontWeight:800, color:C.white }}>
          Validation Rules
        </h2>
        <button className="btn btn-primary" onClick={validate} disabled={loading || rules.length===0}>
          {loading ? <><span className="spin">⟳</span> Running…</> : "▶ Run Validation"}
        </button>
      </div>

      {/* Add rule form */}
      <Card>
        <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                     textTransform:"uppercase", marginBottom:"1rem" }}>Add Rule</h4>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1.5fr auto",
                      gap:".75rem", alignItems:"end" }}>
          <div>
            <label style={{ display:"block", fontSize:".73rem", color:C.muted,
                            marginBottom:".3rem", textTransform:"uppercase" }}>Column</label>
            <input value={form.column_name}
              onChange={e => setForm(f => ({ ...f, column_name:e.target.value }))}
              placeholder="e.g. age"
              style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`,
                       borderRadius:6, padding:".5rem .75rem", color:C.white,
                       fontSize:".85rem" }}/>
          </div>
          <div>
            <label style={{ display:"block", fontSize:".73rem", color:C.muted,
                            marginBottom:".3rem", textTransform:"uppercase" }}>Rule Type</label>
            <select value={form.rule_type}
              onChange={e => {
                setForm(f => ({ ...f, rule_type:e.target.value }));
                setParamStr(RULE_TEMPLATES[e.target.value] ?? "{}");
              }}
              style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`,
                       borderRadius:6, padding:".5rem .75rem", color:C.white, fontSize:".85rem" }}>
              <option value="range">range</option>
              <option value="not_null">not_null</option>
              <option value="unique">unique</option>
              <option value="regex">regex</option>
            </select>
          </div>
          <div>
            <label style={{ display:"block", fontSize:".73rem", color:C.muted,
                            marginBottom:".3rem", textTransform:"uppercase" }}>Parameters (JSON)</label>
            <input value={paramStr} onChange={e => setParamStr(e.target.value)}
              style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`,
                       borderRadius:6, padding:".5rem .75rem", color:C.accent,
                       fontSize:".82rem" }}/>
          </div>
          <button className="btn btn-primary" onClick={addRule}
            disabled={!form.column_name} style={{ height:38 }}>
            + Add
          </button>
        </div>
      </Card>

      {/* Rules list */}
      {rules.length > 0 && (
        <Card>
          <h4 style={{ fontSize:".78rem", color:C.muted, letterSpacing:".1em",
                       textTransform:"uppercase", marginBottom:"1rem" }}>
            Active Rules ({rules.length})
          </h4>
          <div style={{ display:"flex", flexDirection:"column", gap:".45rem" }}>
            {rules.map(r => (
              <div key={r.id} style={{
                display:"flex", alignItems:"center", gap:".75rem",
                padding:".6rem .9rem", borderRadius:7,
                background:`${C.border}33`, border:`1px solid ${C.border}`
              }}>
                <span className="tag" style={{ background:`${C.accent}15`, color:C.accent }}>
                  {r.column_name}
                </span>
                <span className="tag" style={{ background:`${C.amber}15`, color:C.amber }}>
                  {r.rule_type}
                </span>
                <span style={{ flex:1, fontSize:".78rem", color:C.muted,
                               fontFamily:"'Space Mono',monospace" }}>
                  {JSON.stringify(r.parameters)}
                </span>
                <button className="btn btn-danger" onClick={() => deleteRule(r.id)}
                  style={{ padding:".25rem .6rem", fontSize:".75rem" }}>✕</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Validation results */}
      {valResult && (
  <Card className="fade-up" style={{ marginTop: "1rem" }}>
    <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                 textTransform: "uppercase", marginBottom: ".75rem" }}>
      Validation Results
    </h4>
    <div style={{
      padding: ".75rem 1rem",
      borderRadius: 8,
      background: valResult.overall_status === "PASSED" ? `${C.green}15` : `${C.red}15`,
      border: `1px solid ${valResult.overall_status === "PASSED" ? C.green : C.red}33`,
      marginBottom: "1rem"
    }}>
      <p style={{
        fontSize: ".9rem",
        fontWeight: 700,
        color: valResult.overall_status === "PASSED" ? C.green : C.red
      }}>
        {valResult.overall_status === "PASSED" ? "✓ All Rules Passed" : "✗ Validation Failed"}
      </p>
      <p style={{ fontSize: ".78rem", color: C.muted, marginTop: ".3rem" }}>
        {valResult.passed} passed, {valResult.failed} failed
      </p>
    </div>

    {/* Детали по каждому правилу */}
    {valResult.results.map((r) => (
      <div key={r.rule_id} style={{
        padding: ".75rem 1rem",
        borderRadius: 8,
        background: C.surface,
        border: `1px solid ${C.border}`,
        marginBottom: ".75rem"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <span style={{
              fontFamily: "'Space Mono',monospace",
              fontSize: ".85rem",
              color: C.accent
            }}>
              {r.column}
            </span>
            <span style={{
              marginLeft: ".5rem",
              fontSize: ".75rem",
              color: C.muted
            }}>
              {r.rule_type}
            </span>
            {r.parameters && (
              <span style={{
                marginLeft: ".5rem",
                fontSize: ".72rem",
                color: C.muted,
                fontFamily: "'Space Mono',monospace"
              }}>
                {JSON.stringify(r.parameters)}
              </span>
            )}
          </div>
          <span className="tag" style={{
            background: r.status === "PASSED" ? `${C.green}15` :
                       r.status === "SKIPPED" ? `${C.muted}15` : `${C.red}15`,
            color: r.status === "PASSED" ? C.green :
                   r.status === "SKIPPED" ? C.muted : C.red
          }}>
            {r.status}
          </span>
        </div>

        <p style={{
          fontSize: ".78rem",
          color: C.text,
          marginTop: ".5rem"
        }}>
          {r.message}
        </p>

        {/* Показываем нарушения */}
        {r.violation_details && r.violation_details.length > 0 && (
          <div style={{ marginTop: ".75rem" }}>
            <p style={{
              fontSize: ".75rem",
              color: C.muted,
              marginBottom: ".4rem",
              textTransform: "uppercase",
              letterSpacing: ".05em"
            }}>
              Violations ({r.violations} total, showing first {r.violation_details.length}):
            </p>
            <div style={{
              maxHeight: "200px",
              overflowY: "auto",
              background: `${C.red}08`,
              borderRadius: 6,
              padding: ".5rem"
            }}>
              {r.violation_details.map((v, i) => (
                <div key={i} style={{
                  padding: ".4rem .6rem",
                  marginBottom: ".3rem",
                  background: C.card,
                  borderRadius: 4,
                  border: `1px solid ${C.border}`,
                  fontFamily: "'Space Mono',monospace",
                  fontSize: ".72rem"
                }}>
                  <div style={{ color: C.red, marginBottom: ".2rem" }}>
                    Row {v.row_index}: <span style={{ color: C.white }}>{v.column_value}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: ".68rem" }}>
                    {Object.entries(v.row_data).map(([k, val]) => (
                      <span key={k} style={{ marginRight: ".5rem" }}>
                        {k}: {val}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ))}
  </Card>
)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// VERSIONS PANEL
// ══════════════════════════════════════════════════════════════════════════════
function VersionsPanel({ dataset }) {
  const [versions, setVersions] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [selectedV1, setSelectedV1] = useState(null);
  const [selectedV2, setSelectedV2] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      const data = await api(`/datasets/${dataset.id}/versions`);
      setVersions(data.versions || []);
    } catch {}
  }, [dataset.id]);

  useEffect(() => {
    loadVersions();
    setComparison(null);
    setSelectedV1(null);
    setSelectedV2(null);
  }, [loadVersions]);

  const uploadNewVersion = async (file) => {
    if (!file || !file.name.endsWith(".csv")) {
      alert("Only CSV files allowed");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(`/datasets/${dataset.id}/new-version`, { method: "POST", body: fd });
      loadVersions();
      alert("✓ New version uploaded!");
    } catch (e) {
      alert("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const compare = async () => {
    if (!selectedV1 || !selectedV2) {
      alert("Select two versions to compare");
      return;
    }
    setLoading(true);
    try {
      const data = await api(`/datasets/${selectedV1}/compare/${selectedV2}`);
      setComparison(data);
    } catch (e) {
      alert("Compare failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const driftColor = (overall) => {
    return overall === "critical" ? C.red : overall === "warning" ? C.amber : C.green;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Upload new version */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ flex: 1, fontSize: "1.15rem", fontWeight: 800, color: C.white }}>
          🔄 Version History
        </h2>
        <label style={{ cursor: "pointer" }}>
          <span className="btn btn-primary">
            {uploading ? <><span className="spin">⟳</span> Uploading…</> : "+ Upload New Version"}
          </span>
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => uploadNewVersion(e.target.files[0])}
          />
        </label>
      </div>

      {/* Versions list */}
      <Card>
        <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                     textTransform: "uppercase", marginBottom: "1rem" }}>
          Available Versions ({versions.length})
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                padding: ".75rem 1rem",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.surface,
                display: "flex",
                alignItems: "center",
                gap: ".75rem"
              }}
            >
              <input
                type="checkbox"
                checked={selectedV1 === v.id || selectedV2 === v.id}
                onChange={(e) => {
                  if (e.target.checked) {
                    if (!selectedV1) setSelectedV1(v.id);
                    else if (!selectedV2) setSelectedV2(v.id);
                  } else {
                    if (selectedV1 === v.id) setSelectedV1(null);
                    if (selectedV2 === v.id) setSelectedV2(null);
                  }
                }}
                disabled={(selectedV1 && selectedV2 && selectedV1 !== v.id && selectedV2 !== v.id)}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <span className="tag" style={{ background: `${C.accent}15`, color: C.accent }}>
                v{v.version}
              </span>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: ".82rem",
                             color: C.white, flex: 1 }}>
                {v.name}
              </span>
              <span style={{ fontSize: ".74rem", color: C.muted,
                             fontFamily: "'Space Mono',monospace" }}>
                {v.total_rows} rows · {v.total_columns} cols
              </span>
              <span style={{ fontSize: ".74rem", color: C.muted }}>
                {new Date(v.upload_date).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Compare button */}
      {selectedV1 && selectedV2 && (
        <div style={{ textAlign: "center" }}>
          <button className="btn btn-primary" onClick={compare} disabled={loading}>
            {loading ? <><span className="spin">⟳</span> Comparing…</> : "▶ Compare Versions"}
          </button>
        </div>
      )}

      {/* Comparison results */}
      {comparison && (
        <>
          {/* Drift Score */}
          <Card className="fade-up" style={{
            borderColor: `${driftColor(comparison.drift_score?.overall)}44`,
            background: `linear-gradient(135deg, ${C.card}, ${driftColor(comparison.drift_score?.overall)}08)`
          }}>
            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ color: C.muted, fontSize: ".78rem", letterSpacing: ".1em",
                             textTransform: "uppercase", marginBottom: ".5rem" }}>Drift Assessment</h4>
                <p style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: driftColor(comparison.drift_score?.overall)
                }}>
                  {comparison.drift_score?.label || "Unknown"}
                </p>
              </div>
              <div style={{ display: "flex", gap: "1rem" }}>
                <span className="tag" style={{ background: `${C.red}18`, color: C.red }}>
                  {comparison.drift_score?.issues_count || 0} issues
                </span>
                <span className="tag" style={{ background: `${C.green}18`, color: C.green }}>
                  {comparison.drift_score?.improvements_count || 0} improvements
                </span>
              </div>
            </div>
          </Card>

          {/* Row changes */}
          <Card className="fade-up-2">
            <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                         textTransform: "uppercase", marginBottom: ".75rem" }}>Row Changes</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              {[
                { label: "Old", val: comparison.comparison?.row_changes?.old },
                { label: "New", val: comparison.comparison?.row_changes?.new },
                {
                  label: "Diff",
                  val: comparison.comparison?.row_changes?.diff,
                  pct: comparison.comparison?.row_changes?.diff_pct
                }
              ].map((item) => (
                <div key={item.label} style={{
                  padding: ".75rem",
                  background: C.surface,
                  borderRadius: 8,
                  textAlign: "center"
                }}>
                  <div style={{
                    fontSize: "1.3rem",
                    fontWeight: 800,
                    color: C.white,
                    fontFamily: "'Space Mono',monospace"
                  }}>
                    {item.val ?? "—"}
                    {item.pct !== undefined && (
                      <span style={{ fontSize: ".8rem", color: C.muted, marginLeft: ".3rem" }}>
                        ({item.pct > 0 ? "+" : ""}{item.pct}%)
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: ".72rem",
                    color: C.muted,
                    textTransform: "uppercase",
                    marginTop: ".2rem"
                  }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Column changes */}
          {(comparison.comparison?.column_changes?.added?.length > 0 ||
            comparison.comparison?.column_changes?.removed?.length > 0) && (
            <Card className="fade-up-3">
              <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                           textTransform: "uppercase", marginBottom: ".75rem" }}>
                Column Changes
              </h4>
              {comparison.comparison.column_changes.added?.length > 0 && (
                <div style={{ marginBottom: ".75rem" }}>
                  <p style={{ fontSize: ".82rem", color: C.green, marginBottom: ".3rem" }}>
                    ✓ Added columns:
                  </p>
                  <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                    {comparison.comparison.column_changes.added.map((col) => (
                      <span key={col} className="tag" style={{ background: `${C.green}15`, color: C.green }}>
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {comparison.comparison.column_changes.removed?.length > 0 && (
                <div>
                  <p style={{ fontSize: ".82rem", color: C.red, marginBottom: ".3rem" }}>
                    ✗ Removed columns:
                  </p>
                  <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                    {comparison.comparison.column_changes.removed.map((col) => (
                      <span key={col} className="tag" style={{ background: `${C.red}15`, color: C.red }}>
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Quality drift */}
          {Object.keys(comparison.comparison?.quality_drift || {}).length > 0 && (
            <Card className="fade-up">
              <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                           textTransform: "uppercase", marginBottom: ".75rem" }}>
                Quality Drift by Column
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
                {Object.entries(comparison.comparison.quality_drift).map(([col, drift]) => (
                  <div key={col} style={{
                    padding: ".75rem 1rem",
                    background: C.surface,
                    borderRadius: 8,
                    border: `1px solid ${C.border}`
                  }}>
                    <div style={{ marginBottom: ".4rem" }}>
                      <span style={{ fontFamily: "'Space Mono',monospace", fontSize: ".85rem",
                                     color: C.accent }}>{col}</span>
                    </div>
                    {drift.missing_diff !== 0 && (
                      <p style={{ fontSize: ".78rem", color: C.text, marginBottom: ".2rem" }}>
                        Missing: {drift.missing_old}% → {drift.missing_new}%
                        <span style={{
                          color: drift.missing_status === "improved" ? C.green :
                                 drift.missing_status === "degraded" ? C.red : C.muted,
                          marginLeft: ".4rem"
                        }}>
                          ({drift.missing_diff > 0 ? "+" : ""}{drift.missing_diff}%)
                        </span>
                      </p>
                    )}
                    {drift.mean_change_pct !== undefined && (
                      <p style={{ fontSize: ".78rem", color: C.text }}>
                        Mean: {drift.mean_old} → {drift.mean_new}
                        <span style={{
                          color: Math.abs(drift.mean_change_pct) > 20 ? C.red :
                                 Math.abs(drift.mean_change_pct) > 5 ? C.amber : C.muted,
                          marginLeft: ".4rem"
                        }}>
                          ({drift.mean_change_pct > 0 ? "+" : ""}{drift.mean_change_pct}%)
                        </span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Summary */}
          {comparison.comparison?.summary?.length > 0 && (
            <Card className="fade-up">
              <h4 style={{ fontSize: ".78rem", color: C.muted, letterSpacing: ".1em",
                           textTransform: "uppercase", marginBottom: ".75rem" }}>Summary</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: ".4rem" }}>
                {comparison.comparison.summary.map((line, i) => (
                  <p key={i} style={{ fontSize: ".83rem", color: C.text }}>
                    {line}
                  </p>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [datasets, setDatasets]   = useState([]);
  const [selected, setSelected]   = useState(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [sideOpen, setSideOpen]   = useState(true);

  const loadDatasets = useCallback(async () => {
    try { setDatasets(await api("/datasets")); } catch {}
  }, []);

const handleDelete = (deletedId) => {
    setDatasets(prev => prev.filter(ds => ds.id !== deletedId));
    if (selected?.id === deletedId) {
      setSelected(null);
    }
  };

  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  const handleUploaded = (ds) => {
    loadDatasets();
    setSelected(ds);
    setActiveTab("profile");
  };


  const TABS = [
    { id:"profile", label:"📊 Profile" },
    { id:"ai",      label:"✦ AI Agent" },
    { id:"rules",   label:"✓ Rules" },
    { id:"versions", label:"🔄 Versions" },
  ];

  return (
    <>
      <style>{STYLE}</style>

      {/* Scanline overlay for atmosphere */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:999,
        backgroundImage:`repeating-linear-gradient(0deg, transparent, transparent 2px, ${C.bg}08 2px, ${C.bg}08 4px)`,
      }}/>

      {/* Top bar */}
      <header style={{
        position:"sticky", top:0, zIndex:50,
        background:`${C.bg}ee`, backdropFilter:"blur(12px)",
        borderBottom:`1px solid ${C.border}`,
        padding:".75rem 1.5rem",
        display:"flex", alignItems:"center", gap:"1.2rem"
      }}>
        <button className="btn btn-ghost" onClick={() => setSideOpen(o => !o)}
          style={{ padding:".35rem .7rem", fontSize:"1rem" }}>☰</button>
        <div style={{ display:"flex", alignItems:"baseline", gap:".5rem" }}>
          <span style={{ fontSize:"1.1rem", fontWeight:800, color:C.white,
                         letterSpacing:"-.01em" }}>DataQuality</span>
          <span style={{ fontSize:".75rem", color:C.accent, fontFamily:"'Space Mono',monospace",
                         background:`${C.accent}15`, padding:".1rem .4rem",
                         borderRadius:4 }}>PLATFORM</span>
        </div>
        <div style={{ flex:1 }}/>
        <div style={{ width:8, height:8, borderRadius:"50%", background:C.green,
                      boxShadow:`0 0 8px ${C.green}` }} className="pulse"/>
        <span style={{ fontSize:".75rem", color:C.muted, fontFamily:"'Space Mono',monospace" }}>
          API CONNECTED
        </span>
      </header>

      <div style={{ display:"flex", height:"calc(100vh - 53px)" }}>

        {/* Sidebar */}
        <aside style={{
          width: sideOpen ? 280 : 0, minWidth: sideOpen ? 280 : 0,
          overflow:"hidden", transition:"width .25s ease, min-width .25s ease",
          borderRight:`1px solid ${C.border}`,
          display:"flex", flexDirection:"column", gap:"1rem",
          padding: sideOpen ? "1rem" : 0, background: C.surface
        }}>
          <UploadZone onUploaded={handleUploaded}/>
          <DatasetList
            datasets={datasets}
            selected={selected}
            onSelect={ds => {
                setSelected(ds);
                setActiveTab("profile");
             }}
            onDelete={handleDelete}
          />
        </aside>

        {/* Main */}
        <main style={{ flex:1, overflow:"auto", padding:"1.5rem" }}>
          {!selected ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                          justifyContent:"center", height:"100%", gap:"1.5rem",
                          textAlign:"center" }}>
              <div style={{ fontSize:"3.5rem" }}>🔬</div>
              <div>
                <h2 style={{ fontSize:"1.6rem", fontWeight:800, color:C.white,
                             marginBottom:".5rem" }}>Data Quality Platform</h2>
                <p style={{ color:C.muted, maxWidth:360 }}>
                  Upload a CSV dataset and run automated quality analysis,
                  ML anomaly detection, and AI-powered recommendations.
                </p>
              </div>
              <div style={{ display:"flex", gap:"1.5rem", flexWrap:"wrap",
                            justifyContent:"center" }}>
                {[
                  { icon:"📊", label:"Quality Profiling" },
                  { icon:"🤖", label:"AI Insights (Groq)" },
                  { icon:"✓",  label:"Validation Rules" },
                ].map(f => (
                  <div key={f.label} style={{
                    padding:"1rem 1.5rem", borderRadius:10,
                    border:`1px solid ${C.border}`, background:C.card,
                    display:"flex", flexDirection:"column", alignItems:"center", gap:".4rem"
                  }}>
                    <span style={{ fontSize:"1.5rem" }}>{f.icon}</span>
                    <span style={{ fontSize:".82rem", color:C.text }}>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div style={{ display:"flex", gap:".5rem", marginBottom:"1.5rem",
                            borderBottom:`1px solid ${C.border}`, paddingBottom:".75rem" }}>
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className="btn" style={{
                      fontSize:".85rem",
                      background: activeTab===t.id ? `${C.accent}18` : "transparent",
                      color: activeTab===t.id ? C.accent : C.muted,
                      border: `1px solid ${activeTab===t.id ? C.accent+"55" : "transparent"}`
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === "profile" && <ProfilePanel dataset={selected}/>}
              {activeTab === "ai"      && <AIPanel dataset={selected}/>}
              {activeTab === "rules"   && <RulesPanel dataset={selected}/>}
              {activeTab === "versions" && <VersionsPanel dataset={selected}/>}
            </>
          )}
        </main>
      </div>
    </>
  );
}