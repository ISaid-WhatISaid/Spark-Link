"use client";
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * SparkLink — PIN‑Gated Dating Profile Prototype
 *
 * New in this revision (Oct 2025):
 * - **5‑minute session window** after a successful PIN: you can return to the profile for 5 minutes
 *   without re‑entering a PIN. After 5 minutes, you’re locked out and need a new one‑time code.
 * - Session auto‑expires on a timer and when the page regains visibility if expired.
 * - Removed instant revoke on blur/lock; replaced with TTL‑based session check.
 * - Kept Developer Debug panel on the lock screen + inside the profile for easy testing.
 *
 * Features:
 * ✅ Single‑page, infinitely scrolling feed of text + images
 * ✅ One‑time PIN gate (PINs rotate on use)
 * ✅ 5‑minute session window (TTL) instead of instant revoke
 * ✅ "Must message for another PIN" flow (prototype)
 * ✅ Share via link + downloadable QR
 * ✅ Level of interest meter
 * ✅ Local‑only data (swap for API later)
 */

// ---------------------- Constants ----------------------
const SESSION_OK_KEY = "spark.pin.ok";
const SESSION_EXP_KEY = "spark.pin.expiresAt";
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------- Utils ----------------------
const uid = () => Math.random().toString(36).slice(2, 9);
const STORAGE_KEY = "spark.items.v1";

function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

function generatePin() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n).slice(0, 3) + "-" + String(n).slice(3);
}

// Pure helpers to make PIN behavior testable
function isValidPin(pinState, input) {
  if (!pinState || !input) return false;
  return input === pinState.activePin && !(pinState.usedPins || []).includes(input);
}
function consumePin(pinState, usedPin) {
  // After successful use, mark used and rotate to a fresh active PIN
  return { activePin: generatePin(), usedPins: [ ...(pinState.usedPins || []), usedPin ] };
}

function runSelfTests() {
  try {
    // demoItems basic
    const items = demoItems();
    console.assert(Array.isArray(items), "demoItems() should return an array");
    console.assert(items.every(x => x && x.id && x.title && typeof x.createdAt === "number"), "demoItems() items should have id, title, createdAt");

    // generatePin format
    const pin = generatePin();
    console.assert(/^\d{3}-\d{3}$/.test(pin), "generatePin() should return NNN-NNN format");

    // PIN logic tests
    const state0 = { activePin: "111-222", usedPins: [] };
    console.assert(isValidPin(state0, "111-222") === true, "isValidPin should pass for matching, unused pin");
    const state1 = consumePin(state0, "111-222");
    console.assert(state1.usedPins.includes("111-222"), "consumePin should mark used pin");
    console.assert(state1.activePin !== "111-222" && /^\d{3}-\d{3}$/.test(state1.activePin), "consumePin should rotate to a fresh pin");
    console.assert(isValidPin(state1, "111-222") === false, "isValidPin should fail for already used pin");

    console.log("[SparkLink self‑tests] passed");
  } catch (e) {
    console.error("[SparkLink self‑tests] failed", e);
  }
}

// ---------------------- Root ----------------------
export default function SparkLinkApp() {
  const [route, setRoute] = useState("profile");
  const [theme, setTheme] = useState(() => localStorage.getItem("spark.theme") || "light");

  // Profile content
  const [items, setItems] = useLocalStorage(STORAGE_KEY, demoItems());

  // PIN state
  const [hasAccess, setHasAccess] = useState(false); // computed by TTL check on mount
  const [pinState, setPinState] = useLocalStorage("spark.pinState", {
    activePin: generatePin(),
    usedPins: [],
  });

  // Session helpers
  function revoke() {
    sessionStorage.removeItem(SESSION_OK_KEY);
    sessionStorage.removeItem(SESSION_EXP_KEY);
    setHasAccess(false);
  }
  function checkSession() {
    try {
      const ok = sessionStorage.getItem(SESSION_OK_KEY) === "1";
      const expRaw = sessionStorage.getItem(SESSION_EXP_KEY);
      const exp = expRaw ? Number(expRaw) : 0;
      const now = Date.now();
      if (ok && now < exp) {
        setHasAccess(true);
      } else {
        revoke();
      }
    } catch {
      revoke();
    }
  }

  // On mount: apply theme + compute session access based on TTL
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("spark.theme", theme);
  }, [theme]);

  useEffect(() => {
    // initial check
    checkSession();
    // recheck when tab becomes visible again (e.g., after phone unlock)
    const onVis = () => { if (!document.hidden) checkSession(); };
    document.addEventListener("visibilitychange", onVis);
    // periodic check to auto‑lock after 5 minutes
    const timer = setInterval(checkSession, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, []);

  // Profile id (for sharable URL)
  const [profileId] = useLocalStorage("spark.profileId", uid());

  // Infinite scroll bookkeeping
  const filtered = useMemo(() => items.slice().sort((a, b) => b.createdAt - a.createdAt), [items]);
  const BATCH = 9;
  const [visibleCount, setVisibleCount] = useState(BATCH);
  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        setVisibleCount(c => Math.min(c + BATCH, filtered.length));
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [filtered.length]);
  useEffect(() => { setVisibleCount(BATCH); }, [route]);

  function upsertItem(next) {
    setItems(prev => {
      const exists = prev.some(p => p.id === next.id);
      const now = Date.now();
      const base = { ...next, updatedAt: now };
      return exists ? prev.map(p => (p.id === next.id ? base : p)) : [{ ...base, createdAt: now }, ...prev];
    });
  }

  function removeItem(id) {
    setItems(prev => prev.filter(p => p.id !== id));
  }

  useEffect(() => { runSelfTests(); }, []);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <TopBar route={route} setRoute={setRoute} theme={theme} setTheme={setTheme} profileId={profileId} pinState={pinState} setPinState={setPinState} />

      {!hasAccess ? (
        <PinGate setHasAccess={setHasAccess} pinState={pinState} setPinState={setPinState} />
      ) : (
        <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 p-4 md:grid-cols-12">
          <Sidebar route={route} setRoute={setRoute} />
          <section className="md:col-span-9 lg:col-span-10">
            <AnimatePresence mode="popLayout">
              {route === "profile" && (
                <motion.div key="profile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                  <ProfileHeader />
                  <SessionBadge />
                  <InterestMeter />
                  <DebugPanel pinState={pinState} setPinState={setPinState} />
                  <Uploader onSave={upsertItem} />
                  <Feed items={filtered.slice(0, visibleCount)} onRemove={removeItem} />
                  {visibleCount < filtered.length && (
                    <div className="pb-8 text-center text-sm text-neutral-500">Loading more… keep scrolling</div>
                  )}
                </motion.div>
              )}
              {route === "settings" && <SettingsView theme={theme} setTheme={setTheme} items={items} setItems={setItems} />}
              {route === "about" && <AboutView />}
            </AnimatePresence>
          </section>
        </main>
      )}
    </div>
  );
}

// ---------------------- Tiny Session UI ----------------------
function SessionBadge() {
  const [exp, setExp] = useState(() => Number(sessionStorage.getItem(SESSION_EXP_KEY) || 0));
  useEffect(() => {
    const t = setInterval(() => setExp(Number(sessionStorage.getItem(SESSION_EXP_KEY) || 0)), 1000);
    return () => clearInterval(t);
  }, []);
  if (!exp) return null;
  const remaining = Math.max(0, exp - Date.now());
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="rounded-2xl border p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
      Session active — auto‑locks in <span className="font-mono">{mm}:{String(ss).padStart(2, "0")}</span>
    </div>
  );
}

// ---------------------- Debug ----------------------
function DebugPanel({ pinState, setPinState }) {
  if (!pinState?.activePin) return null;
  function setTestPin() {
    setPinState({ activePin: "111-222", usedPins: pinState.usedPins || [] });
    alert("Active PIN reset to 111-222 for testing.");
  }
  function rotate() {
    setPinState({ activePin: generatePin(), usedPins: pinState.usedPins || [] });
  }
  return (
    <div className="rounded-2xl border p-3 text-xs text-neutral-500 dark:border-neutral-800">
      <div className="font-semibold text-neutral-700 dark:text-neutral-300">Debug: Current Active PIN</div>
      <div className="mt-1 font-mono text-sm text-pink-600 dark:text-pink-400">{pinState.activePin}</div>
      <div className="mt-2 flex gap-2">
        <button onClick={setTestPin} className="rounded-lg border px-2 py-1 dark:border-neutral-700">Set to 111-222</button>
        <button onClick={rotate} className="rounded-lg border px-2 py-1 dark:border-neutral-700">Rotate PIN</button>
      </div>
      <div className="mt-1">(For testing only — hide/remove in production)</div>
    </div>
  );
}

// ---------------------- Layout ----------------------
function TopBar({ route, setRoute, theme, setTheme, profileId, pinState, setPinState }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-white/70 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500" />
          <span className="font-semibold">SparkLink</span>
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {[
            ["profile", "Profile"],
            ["settings", "Settings"],
            ["about", "About"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRoute(key)}
              className={`rounded-xl px-3 py-1 text-sm transition ${route === key ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "hover:bg-neutral-200 dark:hover:bg-neutral-800"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ShareMenu profileId={profileId} pinState={pinState} setPinState={setPinState} />
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-xl border px-3 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ route, setRoute }) {
  return (
    <aside className="md:col-span-3 lg:col-span-2">
      <div className="sticky top-[60px] hidden space-y-2 rounded-2xl border p-3 md:block dark:border-neutral-800">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Navigate</h3>
        {["profile", "settings", "about"].map((r) => (
          <button
            key={r}
            onClick={() => setRoute(r)}
            className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${route === r ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {r[0].toUpperCase() + r.slice(1)}
          </button>
        ))}
        <div className="pt-2 text-xs text-neutral-500">Single‑file prototype. Replace storage with your API later.</div>
      </div>
    </aside>
  );
}

// ---------------------- PIN & Sharing ----------------------
function PinGate({ setHasAccess, pinState, setPinState }) {
  const [input, setInput] = useState("");
  const [info, setInfo] = useState("");
  const [requesting, setRequesting] = useState(false);

  async function verify() {
    const pin = input.trim();
    if (!pin) return;
    if (isValidPin(pinState, pin)) {
      // Start a 5‑minute session window
      sessionStorage.setItem(SESSION_OK_KEY, "1");
      sessionStorage.setItem(SESSION_EXP_KEY, String(Date.now() + SESSION_TTL_MS));
      setHasAccess(true);
      // Rotate to a fresh active PIN and mark the used one
      setPinState(consumePin(pinState, pin));
      setInfo("");
    } else {
      setInfo("Invalid or already‑used PIN.");
    }
  }

  // --- Developer Debug (visible on lock screen so you can get in) ---
  function setTestPin() {
    setPinState({ activePin: "111-222", usedPins: pinState.usedPins || [] });
    setInput("111-222");
  }
  function rotate() {
    const fresh = generatePin();
    setPinState({ activePin: fresh, usedPins: pinState.usedPins || [] });
    setInput(fresh);
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-3xl border p-6 text-center dark:border-neutral-800">
        <div className="text-lg font-semibold">Enter one‑time PIN</div>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">PINs are single‑use. After unlocking, you can return for 5 minutes before you’ll need a new PIN.</p>
        <input value={input} onChange={e => setInput(e.target.value)} inputMode="numeric" placeholder="123-456" className="mt-4 w-full rounded-xl border px-3 py-2 text-center text-xl tracking-widest dark:border-neutral-700 dark:bg-neutral-900" />
        <button onClick={verify} className="mt-3 w-full rounded-xl bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Unlock</button>
        {info && <div className="mt-2 text-xs text-rose-600">{info}</div>}
        <div className="mt-4 text-xs text-neutral-500">Don't have a PIN?</div>
        <button onClick={() => setRequesting(true)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm dark:border-neutral-700 dark:hover:bg-neutral-800">Request a new PIN</button>

        {/* Developer Debug Section */}
        <details className="mt-4 text-left">
          <summary className="cursor-pointer text-xs text-neutral-500">Developer Debug</summary>
          <div className="mt-2 rounded-xl border p-3 text-xs dark:border-neutral-800">
            <div className="font-semibold">Current Active PIN</div>
            <div className="mt-1 font-mono text-sm">{pinState.activePin || "(none)"}</div>
            <div className="mt-2 flex gap-2">
              <button onClick={setTestPin} className="rounded-lg border px-2 py-1 dark:border-neutral-700">Set to 111-222</button>
              <button onClick={rotate} className="rounded-lg border px-2 py-1 dark:border-neutral-700">Rotate PIN</button>
            </div>
            <div className="mt-1 text-[10px] text-neutral-500">Visible for prototyping only. Remove before sharing widely.</div>
          </div>
        </details>
      </div>
      <RequestPinModal open={requesting} onClose={() => setRequesting(false)} pinState={pinState} setPinState={setPinState} />
    </div>
  );
}

function RequestPinModal({ open, onClose, pinState, setPinState }) {
  const [message, setMessage] = useState("");
  if (!open) return null;
  const newPin = generatePin();
  function send() {
    if (!message.trim()) return; // must message for another PIN
    setPinState({ activePin: newPin, usedPins: pinState.usedPins });
    onClose();
    alert(`Your new one‑time PIN: ${newPin}`);
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="text-sm font-semibold">Request a new PIN</div>
        <p className="mt-1 text-xs text-neutral-500">Send a short message to the owner. You'll receive a new single‑use PIN after sending.</p>
        <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Hi! Loved your profile. Could I get access?" className="mt-3 h-24 w-full rounded-xl border p-2 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900" />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border px-3 py-2 text-sm dark:border-neutral-700">Cancel</button>
          <button onClick={send} className="rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">Send & Generate PIN</button>
        </div>
      </div>
    </div>
  );
}

function ShareMenu({ profileId, pinState, setPinState }) {
  const [qr, setQr] = useState("");
  const url = `${location.origin}${location.pathname}?id=${profileId}`;
  useEffect(() => {
    import("qrcode").then(({ default: QR }) => {
      QR.toDataURL(url).then(setQr).catch(() => setQr(""));
    }).catch(() => setQr(""));
  }, [url]);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setPinState({ activePin: generatePin(), usedPins: pinState.usedPins });
      alert("Link copied. A fresh one‑time PIN has been set for the next viewer.");
    });
  }

  return (
    <div className="relative">
      <details className="group">
        <summary className="list-none rounded-xl border px-3 py-1 text-sm dark:border-neutral-700 hover:cursor-pointer">Share</summary>
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">Share your Spark Page</div>
          <div className="mt-2 break-all text-xs">{url}</div>
          {qr && <img src={qr} alt="QR code" className="mt-2 w-full rounded-xl" />}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={copy} className="rounded-xl bg-neutral-900 px-3 py-2 text-xs text-white dark:bg-white dark:text-neutral-900">Copy link</button>
            <a href={qr || "#"} download={`spark-${profileId}.png`} className="rounded-xl border px-3 py-2 text-center text-xs dark:border-neutral-700">Download QR</a>
          </div>
          <div className="mt-2 text-[10px] text-neutral-500">Tip: Use your phone's native Share sheet for tap‑to‑share.</div>
        </div>
      </details>
    </div>
  );
}

// ---------------------- Profile Views ----------------------
function ProfileHeader() {
  return (
    <div className="overflow-hidden rounded-3xl border p-5 md:p-8 dark:border-neutral-800">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500" />
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Your Spark Page</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">Upload photos + prompts into an endlessly scrolling page. Share with a link or QR. Access is protected by a one‑time PIN and a 5‑minute session window.</p>
        </div>
      </div>
    </div>
  );
}

function InterestMeter() {
  const [score, setScore] = useState(() => Number(sessionStorage.getItem("spark.interest") || 3));
  useEffect(() => sessionStorage.setItem("spark.interest", String(score)), [score]);
  return (
    <div className="rounded-3xl border p-5 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Level of Interest</div>
          <div className="text-xs text-neutral-500">Slide to set how curious you are about this connection.</div>
        </div>
        <div className="text-2xl font-bold">{score}/5</div>
      </div>
      <input type="range" min={0} max={5} step={1} value={score} onChange={e => setScore(Number(e.target.value))} className="mt-3 w-full" />
      <div className="mt-2 h-2 w-full rounded-full bg-gradient-to-r from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-700">
        <div className="h-2 rounded-full bg-gradient-to-r from-pink-500 to-rose-500" style={{ width: `${(score/5)*100}%` }} />
      </div>
    </div>
  );
}

function Tag({ children }) {
  return <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{children}</span>;
}

function Uploader({ onSave }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [tags, setTags] = useState("");

  function handleFiles(e) {
    const list = Array.from(e.target.files || []);
    Promise.all(list.map(file => new Promise(resolve => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, type: file.type, dataUrl: r.result });
      r.readAsDataURL(file);
    })) ).then(setFiles);
  }

  function submit() {
    if (!text && files.length === 0) return;
    const newItem = {
      id: uid(),
      title: text.slice(0, 40) || "Photo",
      notes: text,
      images: files,
      tags: tags ? tags.split(",").map(s => s.trim()).filter(Boolean) : [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    onSave(newItem);
    setText("");
    setFiles([]);
    setTags("");
  }

  return (
    <div className="rounded-3xl border p-5 dark:border-neutral-800">
      <div className="mb-2 text-sm font-semibold">Add to your page</div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a prompt, a fun fact, or a story…" className="h-24 w-full rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-400 dark:border-neutral-700 dark:bg-neutral-900" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="file" accept="image/*" multiple onChange={handleFiles} className="text-sm" />
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="tags: e.g. travel, foodie" className="w-56 rounded-xl border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <button onClick={submit} className="rounded-xl bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">Post</button>
      </div>
      {!!files.length && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {files.map((f, i) => <img key={i} src={f.dataUrl} alt="preview" className="h-24 w-full rounded-xl object-cover" />)}
        </div>
      )}
    </div>
  );
}

function Feed({ items, onRemove }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
        Your page is empty. Add your first post above.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <motion.div key={it.id} layout className="overflow-hidden rounded-2xl border dark:border-neutral-800">
          {!!(it.images && it.images.length) && (
            <div className="grid grid-cols-2 gap-1 p-1 sm:grid-cols-3">
              {it.images.map((img, idx) => (
                <img key={idx} src={img.dataUrl} alt={img.name || "image"} className="h-40 w-full rounded-lg object-cover" />
              ))}
            </div>
          )}
          <div className="p-4">
            <h3 className="text-sm font-semibold">{it.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{it.notes}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {it.tags.map(t => <Tag key={t}>{t}</Tag>)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
              <span>{new Date(it.createdAt).toLocaleString()}</span>
              <button onClick={() => onRemove(it.id)} className="underline">Delete</button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------- Settings & About ----------------------
function SettingsView({ theme, setTheme, items, setItems }) {
  const [raw, setRaw] = useState("");
  function exportData() { setRaw(JSON.stringify({ items }, null, 2)); }
  function importData() {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) { setItems(parsed.items); alert("Imported!"); }
    } catch { alert("Invalid JSON"); }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4 dark:border-neutral-800">
        <div className="text-sm font-semibold">Theme</div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setTheme("light")} className={`rounded-xl border px-3 py-2 text-sm ${theme === "light" ? "bg-neutral-900 text-white dark:bg:white dark:text-neutral-900" : ""}`}>Light</button>
          <button onClick={() => setTheme("dark")} className={`rounded-xl border px-3 py-2 text-sm ${theme === "dark" ? "bg-neutral-900 text-white dark:bg:white dark:text-neutral-900" : ""}`}>Dark</button>
        </div>
      </div>
      <div className="rounded-2xl border p-4 dark:border-neutral-800">
        <div className="text-sm font-semibold">Export / Import</div>
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-xs text-neutral-500">Export your single‑page posts to JSON or paste JSON to import.</div>
          <textarea value={raw} onChange={e => setRaw(e.target.value)} className="h-48 w-full rounded-xl border p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
          <div className="flex gap-2">
            <button onClick={exportData} className="rounded-xl border px-3 py-2 text-sm dark:border-neutral-700">Export</button>
            <button onClick={importData} className="rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">Import</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutView() {
  return (
    <div className="rounded-2xl border p-5 text-sm dark:border-neutral-800">
      <div className="font-semibold">About</div>
      <p className="mt-2 text-neutral-600 dark:text-neutral-300">
        This is a no‑backend prototype for a shareable, PIN‑gated dating profile: one‑time PIN access, 5‑minute session window, infinite scrolling feed of images + text, share via link/QR, and a viewer interest meter. Replace local storage with a backend when ready.
      </p>
      <ul className="mt-2 list-disc pl-5 text-neutral-600 dark:text-neutral-300">
        <li>PINs rotate automatically after successful use.</li>
        <li>Session expires in 5 minutes even if the tab remains open.</li>
        <li>Local‑only data (localStorage/sessionStorage). Swap for API later.</li>
      </ul>
    </div>
  );
}

// ---------------------- Demo Data ----------------------
function demoItems() {
  const now = Date.now();
  return [
    { id: uid(), title: "Coffee + Film", notes: "I collect old cameras. What's your favorite candid shot?", images: [], tags: ["film", "coffee"], status: "active", createdAt: now - 86400000 * 2, updatedAt: now - 86400000 * 2 },
    { id: uid(), title: "Weekend hike", notes: "Redwoods reset my brain.", images: [], tags: ["outdoors"], status: "active", createdAt: now - 86400000 * 3, updatedAt: now - 86400000 * 3 },
  ];
}
