import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "dreamjournal-entries";

const MOON_PHASES = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
function getMoonPhase() {
  const now = new Date();
  const cycle = ((now.getTime() / 86400000 - 2451550.1) % 29.53058867);
  const idx = Math.round((cycle / 29.53058867) * 8) % 8;
  return MOON_PHASES[Math.abs(idx)];
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

async function analyzeWithClaude(text) {
  const prompt = `Analyze this dream journal entry and extract:
1. People mentioned (real names, fictional characters, archetypes). Return as @Name format.
2. Themes and symbols (emotions, settings, motifs, objects). Return as #hashtag format.
3. A vivid, one-sentence dream summary (max 15 words).
4. Emotional tone: one word (e.g. anxious, peaceful, surreal, nostalgic, exhilarating).

Dream: "${text}"

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "people": ["@Name1", "@Name2"],
  "hashtags": ["#theme1", "#theme2", "#theme3"],
  "summary": "one sentence",
  "mood": "one word"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  const raw = data.content.map(b => b.text || "").join("");
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

function formatEntryForNotes(entry) {
  const divider = "────────────────────────";
  const people = (entry.people || []).join("  ");
  const tags = (entry.hashtags || []).join("  ");
  return [
    `${entry.moon} ${formatDate(entry.date)} · ${formatTime(entry.date)}`,
    `Mood: ${entry.mood || "—"}`,
    ``,
    entry.summary ? `"${entry.summary}"` : "",
    ``,
    entry.text,
    ``,
    people ? `People: ${people}` : "",
    tags ? `Themes: ${tags}` : "",
    divider,
  ].filter(line => line !== null).join("\n");
}

function exportToNotes(entry) {
  const text = formatEntryForNotes(entry);
  const encoded = encodeURIComponent(text);
  // Opens the "Save Dream to Notes" Shortcut and passes the formatted entry as input
  window.location.href = `shortcuts://run-shortcut?name=Save%20Dream%20to%20Notes&input=text&text=${encoded}`;
}

const MOOD_COLORS = {
  anxious: "#e05c5c", peaceful: "#5cb8e0", surreal: "#a05ce0",
  nostalgic: "#e0a05c", exhilarating: "#5ce07c", dark: "#6b7280",
  joyful: "#f0d060", confused: "#c0a0e0", default: "#8b9eb0"
};

function getMoodColor(mood) {
  if (!mood) return MOOD_COLORS.default;
  const key = Object.keys(MOOD_COLORS).find(k => mood.toLowerCase().includes(k));
  return key ? MOOD_COLORS[key] : MOOD_COLORS.default;
}

export default function DreamJournal() {
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("home");
  const [draft, setDraft] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [listening, setListening] = useState(false);
  const [exported, setExported] = useState({});
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setEntries(JSON.parse(saved));
    } catch {}
  }, []);

  function saveEntries(next) {
    setEntries(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  async function handleSubmit() {
    if (!draft.trim()) return;
    setAnalyzing(true);
    let tags = { people: [], hashtags: [], summary: draft.slice(0, 80), mood: "unknown" };
    try { tags = await analyzeWithClaude(draft); } catch {}
    const entry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      text: draft,
      moon: getMoonPhase(),
      ...tags
    };
    saveEntries([entry, ...entries]);
    setDraft("");
    setAnalyzing(false);
    setSelected(entry);
    setView("detail");
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser."); return; }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(" ");
      setDraft(transcript);
    };
    r.onend = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function handleExport(entry) {
    exportToNotes(entry);
    setExported(prev => ({ ...prev, [entry.id]: true }));
  }

  const allTags = [...new Set(entries.flatMap(e => [...(e.people||[]), ...(e.hashtags||[])]))];
  const filtered = entries.filter(e => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    if (filterType === "people") return (e.people||[]).some(p => p.toLowerCase().includes(q));
    if (filterType === "tags") return (e.hashtags||[]).some(h => h.toLowerCase().includes(q));
    return e.text.toLowerCase().includes(q) || e.summary?.toLowerCase().includes(q) ||
      (e.people||[]).some(p => p.toLowerCase().includes(q)) ||
      (e.hashtags||[]).some(h => h.toLowerCase().includes(q));
  });

  const stars = Array.from({length: 80}, (_, i) => ({
    x: Math.random()*100, y: Math.random()*100,
    size: Math.random()*1.5+0.5, delay: Math.random()*4
  }));

  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(160deg, #0a0614 0%, #0d0a1f 40%, #060d1a 100%)",
      fontFamily: "'Georgia', 'Times New Roman', serif", color: "#d4c8f0", position: "relative", overflow: "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Crimson+Pro:wght@300;400&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .star { position: absolute; border-radius: 50%; background: white; animation: twinkle var(--d,3s) ease-in-out infinite alternate; }
        @keyframes twinkle { from { opacity: 0.1; } to { opacity: 0.9; } }
        .entry-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(180,160,255,0.12);
          border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.3s;
          backdrop-filter: blur(8px); }
        .entry-card:hover { background: rgba(180,160,255,0.07); border-color: rgba(180,160,255,0.25); transform: translateY(-2px); }
        .pill { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px;
          font-family: 'Crimson Pro', serif; letter-spacing: 0.03em; margin: 2px; }
        .person-pill { background: rgba(160,200,255,0.12); border: 1px solid rgba(160,200,255,0.3); color: #a0c8ff; }
        .tag-pill { background: rgba(200,160,255,0.12); border: 1px solid rgba(200,160,255,0.3); color: #c8a0ff; }
        textarea { background: rgba(255,255,255,0.04); border: 1px solid rgba(180,160,255,0.2);
          border-radius: 10px; color: #d4c8f0; font-family: 'Crimson Pro', serif; font-size: 17px;
          line-height: 1.7; padding: 16px; width: 100%; resize: none; outline: none; }
        textarea:focus { border-color: rgba(180,160,255,0.5); background: rgba(255,255,255,0.06); }
        textarea::placeholder { color: rgba(180,160,255,0.35); font-style: italic; }
        .btn { border: none; cursor: pointer; border-radius: 8px; font-family: 'Crimson Pro', serif;
          font-size: 15px; letter-spacing: 0.05em; transition: all 0.2s; padding: 11px 22px; }
        .btn-primary { background: linear-gradient(135deg, #6040b0, #4060d0); color: white; }
        .btn-primary:hover { background: linear-gradient(135deg, #7050c0, #5070e0); transform: translateY(-1px); }
        .btn-ghost { background: transparent; color: #a090d0; border: 1px solid rgba(160,140,210,0.25); }
        .btn-ghost:hover { border-color: rgba(160,140,210,0.5); color: #c0b0f0; }
        .btn-voice { background: rgba(255,80,80,0.12); border: 1px solid rgba(255,80,80,0.3); color: #ff8080; }
        .btn-voice.active { background: rgba(255,80,80,0.25); border-color: #ff5050; animation: pulse 1s ease-in-out infinite; }
        .btn-notes { background: rgba(255,220,80,0.08); border: 1px solid rgba(255,220,80,0.25); color: #ffd84a; }
        .btn-notes:hover { background: rgba(255,220,80,0.15); border-color: rgba(255,220,80,0.45); }
        .btn-notes.done { background: rgba(80,200,120,0.1); border-color: rgba(80,200,120,0.35); color: #60d090; }
        @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,80,80,0.3); } 50% { box-shadow: 0 0 0 8px rgba(255,80,80,0); } }
        input[type=text] { background: rgba(255,255,255,0.04); border: 1px solid rgba(180,160,255,0.2);
          border-radius: 8px; color: #d4c8f0; font-family: 'Crimson Pro', serif; font-size: 15px;
          padding: 10px 14px; outline: none; width: 100%; }
        input[type=text]:focus { border-color: rgba(180,160,255,0.45); }
        input::placeholder { color: rgba(180,160,255,0.35); }
        select { background: rgba(255,255,255,0.04); border: 1px solid rgba(180,160,255,0.2);
          border-radius: 8px; color: #a090d0; padding: 10px 12px; font-family: 'Crimson Pro', serif; font-size: 14px; outline: none; }
        .mood-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
        .shimmer { background: linear-gradient(90deg, rgba(180,160,255,0.05) 25%, rgba(180,160,255,0.12) 50%, rgba(180,160,255,0.05) 75%);
          background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .notes-banner { background: rgba(255,220,80,0.06); border: 1px solid rgba(255,220,80,0.18);
          border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; display: flex; align-items: flex-start; gap: 12px; }
        .export-row { display: flex; align-items: center; justify-content: space-between;
          background: rgba(255,220,80,0.05); border: 1px solid rgba(255,220,80,0.15);
          border-radius: 8px; padding: 12px 14px; margin-top: 20px; gap: 12px; }
      `}</style>

      {stars.map((s, i) => (
        <div key={i} className="star" style={{
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          "--d": `${s.delay + 2}s`
        }} />
      ))}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <div style={{ textAlign: "center", padding: "40px 0 24px" }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>{getMoonPhase()}</div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 32,
            letterSpacing: "0.15em", margin: 0, color: "#e8deff", fontStyle: "italic" }}>
            Dream Journal
          </h1>
          <p style={{ color: "rgba(180,160,255,0.4)", fontSize: 13, letterSpacing: "0.1em",
            margin: "6px 0 0", fontFamily: "'Crimson Pro', serif" }}>
            {new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}
          </p>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 28 }}>
          {[["home","☽ Journal"], ["new","✦ Record"], ["search","◎ Explore"]].map(([v, label]) => (
            <button key={v} className="btn" onClick={() => setView(v)}
              style={{ fontSize: 13, letterSpacing: "0.08em", padding: "8px 16px",
                background: view === v ? "rgba(180,160,255,0.15)" : "transparent",
                border: view === v ? "1px solid rgba(180,160,255,0.4)" : "1px solid rgba(180,160,255,0.12)",
                color: view === v ? "#d4c8f0" : "#7060a0" }}>
              {label}
            </button>
          ))}
        </div>

        {/* HOME */}
        {view === "home" && (
          <div className="fade-in">
            {entries.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(180,160,255,0.3)" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🌌</div>
                <p style={{ fontStyle: "italic", fontSize: 16 }}>Your dreamscape awaits.<br/>Record your first dream.</p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setView("new")}>
                  Begin
                </button>
              </div>
            )}
            {entries.map(entry => (
              <div key={entry.id} className="entry-card fade-in" style={{ marginBottom: 14 }}
                onClick={() => { setSelected(entry); setView("detail"); }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 18, marginRight: 8 }}>{entry.moon}</span>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13,
                      color: "rgba(180,160,255,0.5)", letterSpacing: "0.05em" }}>
                      {formatDate(entry.date)} · {formatTime(entry.date)}
                    </span>
                  </div>
                  {entry.mood && (
                    <span style={{ display: "flex", alignItems: "center", fontSize: 12,
                      color: getMoodColor(entry.mood), letterSpacing: "0.06em" }}>
                      <span className="mood-dot" style={{ background: getMoodColor(entry.mood) }} />
                      {entry.mood}
                    </span>
                  )}
                </div>
                <p style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic",
                  fontSize: 16, color: "#c0b4e0", margin: "0 0 10px", lineHeight: 1.5 }}>
                  {entry.summary || entry.text.slice(0, 100) + "…"}
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    {(entry.people||[]).map(p => <span key={p} className="pill person-pill">{p}</span>)}
                    {(entry.hashtags||[]).slice(0,3).map(h => <span key={h} className="pill tag-pill">{h}</span>)}
                  </div>
                  {exported[entry.id] && (
                    <span style={{ fontSize: 11, color: "#60d090", letterSpacing: "0.05em" }}>✓ in Notes</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* NEW ENTRY */}
        {view === "new" && (
          <div className="fade-in">
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: "rgba(180,160,255,0.45)", fontStyle: "italic", fontSize: 14,
                textAlign: "center", margin: "0 0 16px", letterSpacing: "0.04em" }}>
                While the dream still clings to waking — describe what you remember
              </p>
              <textarea
                ref={textareaRef}
                rows={10}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="I was in a vast library that kept shifting… someone familiar waited at the end of a corridor…"
              />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className={`btn btn-voice ${listening ? "active" : ""}`}
                onClick={listening ? stopListening : startListening}>
                {listening ? "⏹ Stop" : "🎙 Dictate"}
              </button>
              <button className="btn btn-primary" onClick={handleSubmit}
                disabled={analyzing || !draft.trim()}
                style={{ opacity: analyzing || !draft.trim() ? 0.5 : 1, flex: 1 }}>
                {analyzing ? "Weaving symbols…" : "✦ Analyze & Save"}
              </button>
            </div>
            {analyzing && (
              <div style={{ marginTop: 20 }}>
                <div className="shimmer" style={{ height: 16, marginBottom: 8 }} />
                <div className="shimmer" style={{ height: 16, width: "70%" }} />
                <p style={{ textAlign: "center", color: "rgba(180,160,255,0.4)", fontSize: 13,
                  fontStyle: "italic", marginTop: 12 }}>Claude is reading your symbols…</p>
              </div>
            )}
          </div>
        )}

        {/* DETAIL */}
        {view === "detail" && selected && (
          <div className="fade-in">
            <button className="btn btn-ghost" style={{ marginBottom: 20, fontSize: 13 }}
              onClick={() => setView("home")}>← Back</button>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 14,
              border: "1px solid rgba(180,160,255,0.15)", padding: 24 }}>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 28 }}>{selected.moon}</span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13,
                    color: "rgba(180,160,255,0.5)" }}>{formatDate(selected.date)}</div>
                  <div style={{ fontSize: 12, color: "rgba(180,160,255,0.35)" }}>{formatTime(selected.date)}</div>
                </div>
              </div>

              {selected.mood && (
                <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                  <span className="mood-dot" style={{ background: getMoodColor(selected.mood), width:10, height:10 }} />
                  <span style={{ color: getMoodColor(selected.mood), fontSize: 14, letterSpacing: "0.08em" }}>
                    {selected.mood}
                  </span>
                </div>
              )}

              {selected.summary && (
                <p style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic",
                  fontSize: 20, color: "#d0c4f0", lineHeight: 1.6, marginBottom: 20,
                  borderLeft: "2px solid rgba(180,160,255,0.25)", paddingLeft: 14 }}>
                  {selected.summary}
                </p>
              )}

              <p style={{ fontFamily: "'Crimson Pro', serif", fontSize: 16, lineHeight: 1.8,
                color: "#b0a4d0", marginBottom: 24, whiteSpace: "pre-wrap" }}>
                {selected.text}
              </p>

              {(selected.people?.length > 0) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(160,200,255,0.5)",
                    marginBottom: 8, textTransform: "uppercase" }}>People</div>
                  {selected.people.map(p => (
                    <span key={p} className="pill person-pill" style={{ cursor: "pointer" }}
                      onClick={() => { setFilter(p); setFilterType("people"); setView("search"); }}>
                      {p}
                    </span>
                  ))}
                </div>
              )}

              {(selected.hashtags?.length > 0) && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "rgba(200,160,255,0.5)",
                    marginBottom: 8, textTransform: "uppercase" }}>Themes</div>
                  {selected.hashtags.map(h => (
                    <span key={h} className="pill tag-pill" style={{ cursor: "pointer" }}
                      onClick={() => { setFilter(h); setFilterType("tags"); setView("search"); }}>
                      {h}
                    </span>
                  ))}
                </div>
              )}

              {/* ── Export to Apple Notes ── */}
              <div className="export-row">
                <div>
                  <div style={{ fontSize: 13, color: "#ffd84a", marginBottom: 3 }}>
                    📓 Save to iPhone Notes
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,220,80,0.45)", lineHeight: 1.4 }}>
                    Appends this dream to your "Dream Journal" note via Shortcuts
                  </div>
                </div>
                <button
                  className={`btn btn-notes ${exported[selected.id] ? "done" : ""}`}
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  onClick={() => handleExport(selected)}>
                  {exported[selected.id] ? "✓ Sent!" : "Send to Notes →"}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* SEARCH / EXPLORE */}
        {view === "search" && (
          <div className="fade-in">
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="text" placeholder="Search dreams, people, themes…"
                value={filter} onChange={e => setFilter(e.target.value)} />
              <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                <option value="all">All</option>
                <option value="people">People</option>
                <option value="tags">Themes</option>
              </select>
            </div>

            {!filter && allTags.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(180,160,255,0.4)",
                  marginBottom: 10, textTransform: "uppercase" }}>All Tags</div>
                {allTags.map(t => (
                  <span key={t}
                    className={`pill ${t.startsWith("@") ? "person-pill" : "tag-pill"}`}
                    style={{ cursor: "pointer", fontSize: 13 }}
                    onClick={() => { setFilter(t); setFilterType(t.startsWith("@") ? "people" : "tags"); }}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div style={{ color: "rgba(180,160,255,0.4)", fontSize: 13, marginBottom: 14 }}>
              {filtered.length} dream{filtered.length !== 1 ? "s" : ""}
              {filter && ` matching "${filter}"`}
            </div>

            {filtered.map(entry => (
              <div key={entry.id} className="entry-card fade-in" style={{ marginBottom: 12 }}
                onClick={() => { setSelected(entry); setView("detail"); }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(180,160,255,0.45)" }}>
                    {entry.moon} {formatDate(entry.date)}
                  </span>
                  {entry.mood && (
                    <span style={{ fontSize: 12, color: getMoodColor(entry.mood) }}>{entry.mood}</span>
                  )}
                </div>
                <p style={{ fontStyle: "italic", fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 15, color: "#b8acd8", margin: "0 0 8px" }}>
                  {entry.summary}
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    {(entry.people||[]).map(p => <span key={p} className="pill person-pill">{p}</span>)}
                    {(entry.hashtags||[]).slice(0,3).map(h => <span key={h} className="pill tag-pill">{h}</span>)}
                  </div>
                  {exported[entry.id] && (
                    <span style={{ fontSize: 11, color: "#60d090" }}>✓ in Notes</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}
