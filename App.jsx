
import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./App.css";

// ================= CONFIGURATION =================

const DISPLAY_RANGE_MM = 6000;

// A target disappears if it has not been updated for 2.5 seconds.
const ACTIVE_WINDOW_MS = 2500;

// Nearby radar slots within this distance are grouped into one marker.
// This is a proximity filter, not guaranteed human identification.
const DUPLICATE_DISTANCE_MM = 350;

// ================= ICONS =================

function Icon({ name, size = 19, strokeWidth = 1.7 }) {
  const content = {
    radar: <>
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="5"/>
      <circle cx="12" cy="12" r="1.3"/>
      <path d="M12 12 18.5 5.5"/>
    </>,
    dashboard: <>
      <rect x="3" y="3" width="7" height="7" rx="1.4"/>
      <rect x="14" y="3" width="7" height="7" rx="1.4"/>
      <rect x="3" y="14" width="7" height="7" rx="1.4"/>
      <rect x="14" y="14" width="7" height="7" rx="1.4"/>
    </>,
    target: <>
      <circle cx="12" cy="12" r="7"/>
      <circle cx="12" cy="12" r="2.5"/>
      <path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>
    </>,
    activity: <path d="M2 12h4l3-7 5 14 3-7h5"/>,
    database: <>
      <ellipse cx="12" cy="5" rx="8" ry="3"/>
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>
    </>,
    shield: <>
      <path d="M12 2 21 6v6c0 5-3.7 8.5-9 10-5.3-1.5-9-5-9-10V6z"/>
      <path d="m8.6 12 2.3 2.3 4.7-4.7"/>
    </>,
    logout: <>
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/>
      <path d="M14 7l5 5-5 5M19 12H9"/>
    </>,
    arrowup: <>
      <path d="M6 18 18 6M8 6h10v10"/>
    </>,
    radio: <>
      <circle cx="12" cy="17" r="2"/>
      <path d="M12 15V3M6.5 6.5a8 8 0 0 1 11 0M3.5 3.5a12 12 0 0 1 17 0"/>
    </>,
    layers: <>
      <path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/>
    </>,
    clock: <>
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 6v6l4 2"/>
    </>,
    lock: <>
      <rect x="5" y="10" width="14" height="11" rx="2"/>
      <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
    </>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    alert: <>
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7v5M12 16h.01"/>
    </>
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content[name] || content.target}
    </svg>
  );
}

// ================= BRAND =================

function Logo({ compact = false }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-symbol">
        <Icon name="radar" size={21}/>
      </div>

      <div className="brand-type">
        <strong>LORA<span>/</span>TRACK</strong>
        <small>RADAR MONITORING PLATFORM</small>
      </div>
    </div>
  );
}

// ================= TIME HELPERS =================

function timeNumber(timestamp) {
  if (!timestamp) return 0;

  if (typeof timestamp.toMillis === "function") {
    return timestamp.toMillis();
  }

  if (typeof timestamp.seconds === "number") {
    return timestamp.seconds * 1000;
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === "number") {
    return timestamp;
  }

  return 0;
}

function readableTime(timestamp) {
  if (!timestamp) return "Time unavailable";

  let date = null;

  if (typeof timestamp.toDate === "function") {
    date = timestamp.toDate();
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp.seconds === "number") {
    date = new Date(timestamp.seconds * 1000);
  } else if (typeof timestamp === "number") {
    date = new Date(timestamp);
  }

  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("en-PK", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      })
    : "Time unavailable";
}

function num(value, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        maximumFractionDigits: digits
      })
    : "—";
}

// ================= RADAR GEOMETRY =================

const drawX = (x) => 380 + (x / DISPLAY_RANGE_MM) * 315;
const drawY = (y) => 390 - (y / DISPLAY_RANGE_MM) * 315;

const validPoint = (target) =>
  target &&
  typeof target.x === "number" &&
  Number.isFinite(target.x) &&
  typeof target.y === "number" &&
  Number.isFinite(target.y) &&
  Math.abs(target.x) <= DISPLAY_RANGE_MM &&
  target.y >= 0 &&
  target.y <= DISPLAY_RANGE_MM;

function isRecent(timestamp, now) {
  const readingTime = timeNumber(timestamp);

  return (
    readingTime > 0 &&
    now - readingTime <= ACTIVE_WINDOW_MS &&
    readingTime - now < 10000
  );
}

function distanceFromXY(target) {
  return Number.isFinite(target?.x) && Number.isFinite(target?.y)
    ? Math.hypot(target.x, target.y) / 1000
    : null;
}

function angleFromXY(target) {
  return Number.isFinite(target?.x) && Number.isFinite(target?.y)
    ? Math.atan2(target.x, target.y) * 180 / Math.PI
    : null;
}

// ================= NEARBY TARGET FILTER =================

// If two radar target slots report positions very close to each other,
// show only one marker. The newest measurement is preferred.
//
// Important: two real people standing closer than the threshold may also
// be grouped. This threshold may need adjustment during physical testing.

function deduplicateNearbyTargets(items) {
  const sorted = [...items].sort(
    (a, b) =>
      timeNumber(b.lastSeenAt || b.timestamp) -
      timeNumber(a.lastSeenAt || a.timestamp)
  );

  const result = [];

  for (const candidate of sorted) {
    const duplicate = result.some((existing) => {
      const separation = Math.hypot(
        candidate.x - existing.x,
        candidate.y - existing.y
      );

      return separation <= DUPLICATE_DISTANCE_MM;
    });

    if (!duplicate) {
      result.push(candidate);
    }
  }

  return result;
}

// ================= RADAR PLANE =================

function RadarPlane({ targets, selected, onSelect }) {
  const visibleTargets = targets.filter(validPoint);

  return (
    <div className="radar-frame">
      <svg
        viewBox="0 0 760 465"
        className="radar-canvas"
        role="img"
        aria-label="Live radar XY plot"
      >
        <defs>
          <pattern
            id="xyGrid"
            width="31.5"
            height="31.5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 31.5 0 L 0 0 0 31.5"
              fill="none"
              stroke="#CF9475"
              strokeOpacity=".09"
              strokeWidth="1"
            />
          </pattern>

          <radialGradient id="radarGlow" cx="50%" cy="95%" r="80%">
            <stop offset="0%" stopColor="#8E381B" stopOpacity=".21"/>
            <stop offset="100%" stopColor="#100F12" stopOpacity="0"/>
          </radialGradient>

          <linearGradient id="radarBeam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FF874E" stopOpacity="0"/>
            <stop offset="100%" stopColor="#FF874E" stopOpacity=".17"/>
          </linearGradient>

          <clipPath id="radarMask">
            <rect x="52" y="49" width="656" height="342" rx="8"/>
          </clipPath>
        </defs>

        <rect
          x="52"
          y="49"
          width="656"
          height="342"
          rx="8"
          fill="url(#radarGlow)"
        />

        <rect
          x="52"
          y="49"
          width="656"
          height="342"
          rx="8"
          fill="url(#xyGrid)"
        />

        <g clipPath="url(#radarMask)">
          {[78.75, 157.5, 236.25, 315].map((radius) => (
            <circle
              key={radius}
              cx="380"
              cy="390"
              r={radius}
              fill="none"
              stroke="#EE8D60"
              strokeWidth="1.1"
              strokeOpacity=".22"
            />
          ))}

          <path
            d="M52 390 H708 M380 49 V390"
            stroke="#DCA180"
            strokeWidth="1"
            strokeDasharray="6 7"
            strokeOpacity=".4"
          />

          <g className="radar-sweep">
            <path
              d="M380 390 L380 75 A315 315 0 0 1 580 149 Z"
              fill="url(#radarBeam)"
            />
            <path
              d="M380 390 V75"
              stroke="#F8A57B"
              strokeOpacity=".26"
            />
          </g>

          {visibleTargets.map((target) => {
            const isSelected = selected === target.id;
            const cx = drawX(target.x);
            const cy = drawY(target.y);

            return (
              <g
                key={target.id}
                className="radar-target"
                transform={`translate(${cx} ${cy})`}
                style={{
                  transition: "transform 180ms linear",
                  cursor: "pointer"
                }}
                onClick={() => onSelect(target.id)}
                role="button"
                tabIndex={0}
                aria-label={`Select active target ${target.targetId}`}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" ||
                    event.key === " "
                  ) {
                    event.preventDefault();
                    onSelect(target.id);
                  }
                }}
              >
                <circle
                  cx="0"
                  cy="0"
                  r={isSelected ? 21 : 16}
                  fill="#FF8A56"
                  fillOpacity=".1"
                />

                <circle
                  cx="0"
                  cy="0"
                  r={isSelected ? 10 : 8}
                  fill="#FF915F"
                  fillOpacity=".25"
                  stroke="#FFB184"
                  strokeWidth="1.5"
                />

                <circle
                  cx="0"
                  cy="0"
                  r="3.7"
                  fill="#FFF4EA"
                />

                <text
                  x="15"
                  y="-13"
                  className="svg-target-label"
                >
                  {target.targetId.slice(0, 12)}
                </text>
              </g>
            );
          })}
        </g>

        <circle cx="380" cy="390" r="7" fill="#F9A575"/>
        <circle
          cx="380"
          cy="390"
          r="15"
          fill="none"
          stroke="#F9A575"
          strokeOpacity=".5"
        />

        <text
          x="380"
          y="438"
          textAnchor="middle"
          className="svg-radar-caption"
        >
          SENSOR ORIGIN · (0, 0)
        </text>

        <text x="52" y="438" className="svg-radar-caption">−X</text>

        <text
          x="706"
          y="438"
          textAnchor="end"
          className="svg-radar-caption"
        >
          +X
        </text>

        <text x="391" y="67" className="svg-radar-caption">+Y</text>

        <text x="392" y="313" className="svg-distance">1.5 m</text>
        <text x="392" y="234" className="svg-distance">3 m</text>
        <text x="392" y="155" className="svg-distance">4.5 m</text>
        <text x="392" y="77" className="svg-distance">6 m</text>
      </svg>

      <div className="plane-overlay-top">
        <span className="indicator-dot"/>
        LIVE POSITION
        <span className="radar-divider"/>
        2D X–Y
      </div>

      {visibleTargets.length === 0 && (
        <div className="radar-empty">
          No active targets — waiting for live measurements
        </div>
      )}
    </div>
  );
}

// ================= STAT CARD =================

function StatCard({ label, value, footer, icon, orange = false }) {
  return (
    <div className={`stat-card ${orange ? "stat-accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon name={icon} size={18}/>
        </span>
      </div>

      <strong className="stat-value">{value}</strong>

      <div className="stat-footer">{footer}</div>
    </div>
  );
}

// ================= MAIN APP =================

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");

  const [readings, setReadings] = useState([]);
  const [syncState, setSyncState] = useState("connecting");
  const [syncError, setSyncError] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Recheck freshness frequently so inactive targets disappear promptly.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(timer);
  }, []);

  // ================= AUTHENTICATION =================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (!currentUser) {
        setReadings([]);
        setSelectedId(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // ================= FIRESTORE LISTENER =================

  useEffect(() => {
    if (!user) return undefined;

    setSyncState("connecting");
    setSyncError("");

    const unsubscribe = onSnapshot(
      collection(db, "radarreadings"),

      (snapshot) => {
        const rows = snapshot.docs
          .filter((doc) => doc.id !== "reading001")
          .map((doc) => {
            const data = doc.data();

            return {
              ...data,
              id: doc.id,
              targetId: String(
                data.targetId ||
                data.targerId ||
                doc.id
              )
            };
          });

        setReadings(rows);
        setSyncState("connected");
      },

      (error) => {
        setReadings([]);
        setSyncState("error");
        setSyncError(error.code || error.message || "Unknown error");
      }
    );

    return () => unsubscribe();
  }, [user]);

  // ================= ACTIVE TARGET FILTER =================

  const targets = useMemo(() => {
    const activeReadings = readings.filter((target) => {
      const lastSeen = target.lastSeenAt || target.timestamp;

      return (
        target.source === "hardware" &&
        validPoint(target) &&
        isRecent(lastSeen, now)
      );
    });

    return deduplicateNearbyTargets(activeReadings);
  }, [readings, now]);

  const selected =
    targets.find((target) => target.id === selectedId) ||
    targets[0] ||
    null;

  const latest = useMemo(() => {
    return [...targets].sort(
      (a, b) =>
        timeNumber(b.lastSeenAt || b.timestamp) -
        timeNumber(a.lastSeenAt || a.timestamp)
    )[0] || null;
  }, [targets]);

  const hasRecentHardware = targets.length > 0;

  const cloudStatus =
    syncState === "connected"
      ? "Cloud synced"
      : syncState === "connecting"
        ? "Connecting"
        : "Connection issue";

  // ================= LOGIN =================

  async function handleLogin(event) {
    event.preventDefault();

    setAuthError("");
    setSigningIn(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setPassword("");
    } catch (error) {
      setAuthError(
        `Sign-in unsuccessful: ${error.code || "Please try again"}`
      );
    } finally {
      setSigningIn(false);
    }
  }

  // ================= LOADING =================

  if (!authReady) {
    return (
      <div className="app-loader">
        <span className="loader-ring"/>
        Initializing monitoring console...
      </div>
    );
  }

  // ================= LOGIN PAGE =================

  if (!user) {
    return (
      <div className="auth-page">
        <header className="auth-navbar">
          <Logo/>
          <div className="header-label">
            <span className="status-pin"/>
            SECURE ACCESS PORTAL
          </div>
        </header>

        <main className="auth-layout">
          <section className="auth-hero">
            <div className="eyebrow">
              <span className="eyebrow-mark"/>
              ENGINEERING RESEARCH PROTOTYPE
              <span className="eyebrow-rule"/>
            </div>

            <h1>
              LoRa-Enabled<br/>
              <span>Multi-Target</span><br/>
              Human Tracking<br/>
              System<span className="orange-period">.</span>
            </h1>

            <p className="hero-subtitle">
              Using 24-GHz FMCW mmWave Radar
            </p>

            <p className="hero-copy">
              A unified platform for spatial detection,
              movement analysis, and long-range radar telemetry.
            </p>

            <div className="hero-chips">
              <span><Icon name="radar" size={15}/> RADAR SENSING</span>
              <span><Icon name="radio" size={15}/> LORA ENABLED</span>
              <span><Icon name="shield" size={15}/> CAMERA-FREE</span>
            </div>

            <div className="orbital-light" aria-hidden="true">
              <span className="orbital-sun"/>
              <span className="orbital-horizon"/>
            </div>
          </section>

          <section className="auth-panel-wrap">
            <div className="auth-panel">
              <div className="auth-panel-top">
                <span className="auth-top-icon">
                  <Icon name="lock" size={20}/>
                </span>
                <span className="auth-small-label">
                  AUTHORIZED ACCESS
                </span>
              </div>

              <h2>
                Welcome back<span className="orange-period">.</span>
              </h2>

              <p className="auth-description">
                Access your monitoring workspace.
              </p>

              <form className="auth-form" onSubmit={handleLogin}>
                <label htmlFor="user-email">Email address</label>

                <input
                  id="user-email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />

                <label htmlFor="user-password">Password</label>

                <input
                  id="user-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />

                <button
                  className="auth-submit"
                  type="submit"
                  disabled={signingIn}
                >
                  {signingIn ? "Signing in..." : "Enter console"}
                  <Icon name="arrowup" size={18}/>
                </button>

                {authError && (
                  <div className="auth-error" role="alert">
                    {authError}
                  </div>
                )}
              </form>

              <div className="auth-panel-bottom">
                <Icon name="shield" size={16}/>
                Protected sign-in · Firebase Authentication
              </div>
            </div>

            <p className="auth-side-note">
              LoRa / ESP32 / mmWave
              <span>—</span>
              Spatial intelligence interface
            </p>
          </section>
        </main>

        <footer className="auth-footer">
          © RESEARCH PROTOTYPE
          <span>TC-307 · COMMUNICATION SYSTEMS</span>
        </footer>
      </div>
    );
  }

  // ================= DASHBOARD =================

  return (
    <div className="dashboard-shell" id="overview">
      <aside className="sidebar">
        <Logo compact/>

        <div className="side-separator"/>

        <p className="sidebar-overline">WORKSPACE</p>

        <nav className="side-navigation" aria-label="Dashboard navigation">
          <a className="side-link is-active" href="#overview">
            <Icon name="dashboard"/>
            Overview
            <Icon name="chevron" size={15}/>
          </a>

          <a className="side-link" href="#spatial">
            <Icon name="radar"/>
            Spatial monitor
          </a>

          <a className="side-link" href="#targets">
            <Icon name="target"/>
            Active targets
          </a>

          <a className="side-link" href="#systems">
            <Icon name="activity"/>
            System status
          </a>
        </nav>

        <div className="sidebar-grow"/>

        <div className="sidebar-foot-card">
          <span className="mini-orange-dot"/>
          HARDWARE FEED

          <strong>
            {hasRecentHardware ? "Live telemetry" : "No active telemetry"}
          </strong>

          <p>
            Based on the latest hardware readings received by Firestore.
          </p>
        </div>

        <p className="sidebar-version">
          ENGINEERING PROJECT · v1.0
        </p>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="crumb">
            CONTROL CENTER
            <Icon name="chevron" size={13}/>
            OVERVIEW
          </div>

          <div className="topbar-right">
            <div className={`cloud-badge ${syncState === "connected" ? "is-ok" : ""}`}>
              <span className="badge-dot"/>
              {cloudStatus}
            </div>

            <button
              className="signout"
              onClick={() => signOut(auth)}
            >
              <Icon name="logout" size={17}/>
              Sign out
            </button>
          </div>
        </header>

        <div className="dashboard-heading">
          <div>
            <div className="eyebrow dashboard-eyebrow">
              <span className="eyebrow-mark"/>
              LIVE DATABASE VIEW
              <span className="eyebrow-rule"/>
            </div>

            <h1>
              Operational <span>overview.</span>
            </h1>

            <p>
              Live radar coordinates, movement measurements,
              and connectivity.
            </p>
          </div>

          <div className="heading-orbit" aria-hidden="true">
            <Icon name="radar" size={52} strokeWidth={.8}/>
          </div>
        </div>

        <div className="demo-banner">
          <Icon name="alert" size={18}/>

          <span>
            <strong>Live hardware feed</strong>
            {" "}— Only targets updated within the last 2.5 seconds
            are displayed. Inactive targets are automatically hidden.
            Nearby detections within 350 mm are grouped.
          </span>
        </div>

        {/* ================= STATISTICS ================= */}

        <div className="stats-grid">
          <StatCard
            label="ACTIVE TARGETS"
            value={String(targets.length).padStart(2, "0")}
            footer="Currently detected hardware targets"
            icon="target"
            orange
          />

          <StatCard
            label="LATEST SPEED"
            value={latest ? num(latest.speed) : "—"}
            footer="m/s · latest active measurement"
            icon="activity"
          />

          <StatCard
            label="DUPLICATE FILTER"
            value="0.35 m"
            footer="Nearby radar detections grouped"
            icon="layers"
          />

          <StatCard
            label="DATABASE"
            value={
              syncState === "connected"
                ? "Synced"
                : syncState === "error"
                  ? "Error"
                  : "Loading"
            }
            footer="Firestore live listener"
            icon="database"
          />
        </div>

        {/* ================= RADAR AND PROFILE ================= */}

        <div className="dashboard-columns">
          <section className="surface radar-surface" id="spatial">
            <div className="surface-header">
              <div>
                <p className="surface-eyebrow">
                  SPATIAL INTELLIGENCE
                </p>

                <h2>Radar positioning</h2>

                <p>
                  Live position of currently detected targets
                </p>
              </div>

              <div className="outlined-pill">
                <span className="mini-orange-dot"/>
                LIVE 2D PLANE
              </div>
            </div>

            <div className="radar-legend">
              <span>
                <b className="legend-target"/>
                Active target · Smooth movement
              </span>

              <span>
                <b className="legend-arc"/>
                Metre rings
              </span>

              <span className="radar-range">
                VIEW · ±6 m X / 6 m Y
              </span>
            </div>

            <RadarPlane
              targets={targets}
              selected={selected?.id}
              onSelect={setSelectedId}
            />

            <div className="radar-footer">
              <span>
                <Icon name="target" size={15}/>
                Origin (0, 0) · millimetre inputs
              </span>

              <span>
                Active readings only
              </span>
            </div>
          </section>

          <div className="side-stack">
            {/* ================= SELECTED TARGET ================= */}

            <section className="surface target-surface" id="targets">
              <div className="surface-header compact">
                <div>
                  <p className="surface-eyebrow">
                    TARGET PROFILE
                  </p>

                  <h2>Selected target</h2>
                </div>

                <Icon name="target" size={20}/>
              </div>

              {selected ? (
                <>
                  <div className="selected-target">
                    <div className="selected-icon">
                      <Icon name="target" size={24}/>
                    </div>

                    <div>
                      <strong>{selected.targetId}</strong>
                      <span>
                        {selected.deviceId || "Radar target"} · Live measurement
                      </span>
                    </div>

                    <span className="recorded-pill">
                      ACTIVE
                    </span>
                  </div>

                  <div className="property-table">
                    <div>
                      <span>X coordinate</span>
                      <strong>{num(selected.x)} mm</strong>
                    </div>

                    <div>
                      <span>Y coordinate</span>
                      <strong>{num(selected.y)} mm</strong>
                    </div>

                    <div>
                      <span>Speed</span>
                      <strong>{num(selected.speed)} m/s</strong>
                    </div>

                    <div>
                      <span>Distance (from XY)</span>
                      <strong>{num(distanceFromXY(selected), 2)} m</strong>
                    </div>

                    <div>
                      <span>Angle (from XY)</span>
                      <strong>{num(angleFromXY(selected), 2)}°</strong>
                    </div>

                    <div>
                      <span>Last seen</span>
                      <strong className="date-text">
                        {readableTime(selected.lastSeenAt || selected.timestamp)}
                      </strong>
                    </div>
                  </div>
                </>
              ) : (
                <p className="empty-text">
                  No active targets. Waiting for radar measurements...
                </p>
              )}

              <p className="card-footnote">
                <Icon name="database" size={14}/>
                Source: radarreadings collection
              </p>
            </section>

            {/* ================= SYSTEM STATUS ================= */}

            <section className="surface system-surface" id="systems">
              <div className="surface-header compact">
                <div>
                  <p className="surface-eyebrow">
                    DEVICE HEALTH
                  </p>

                  <h2>System connections</h2>
                </div>

                <Icon name="radio" size={20}/>
              </div>

              <div className="system-list">
                <div>
                  <span className="system-symbol">
                    <Icon name="database" size={17}/>
                  </span>

                  <span className="system-copy">
                    <strong>Cloud Firestore</strong>
                    <small>Real-time listener</small>
                  </span>

                  <span className={`system-state ${syncState === "connected" ? "good" : "pending"}`}>
                    {cloudStatus}
                  </span>
                </div>

                <div>
                  <span className="system-symbol">
                    <Icon name="radio" size={17}/>
                  </span>

                  <span className="system-copy">
                    <strong>LoRa telemetry</strong>
                    <small>Latest hardware readings</small>
                  </span>

                  <span className={`system-state ${hasRecentHardware ? "good" : "pending"}`}>
                    {hasRecentHardware ? "Active" : "Inactive"}
                  </span>
                </div>

                <div>
                  <span className="system-symbol">
                    <Icon name="radar" size={17}/>
                  </span>

                  <span className="system-copy">
                    <strong>Radar measurements</strong>
                    <small>Fresh target packets</small>
                  </span>

                  <span className={`system-state ${hasRecentHardware ? "good" : "pending"}`}>
                    {hasRecentHardware ? "Detected" : "Waiting"}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* ================= ACTIVE TARGET REGISTRY ================= */}

        <section className="surface registry-surface">
          <div className="surface-header">
            <div>
              <p className="surface-eyebrow">
                LIVE DATA OVERVIEW
              </p>

              <h2>Active target registry</h2>

              <p>
                Only currently active radar detections are shown
              </p>
            </div>

            <span className="outlined-pill">
              {targets.length} ACTIVE TARGET{targets.length === 1 ? "" : "S"}
            </span>
          </div>

          <div className="registry-scroll">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>TARGET</th>
                  <th>X POSITION</th>
                  <th>Y POSITION</th>
                  <th>SPEED</th>
                  <th>LAST SEEN</th>
                  <th>STATE</th>
                </tr>
              </thead>

              <tbody>
                {targets.length ? (
                  targets.map((target) => (
                    <tr
                      key={target.id}
                      className={
                        selected?.id === target.id
                          ? "registry-selected"
                          : ""
                      }
                      onClick={() => setSelectedId(target.id)}
                    >
                      <td>
                        <span className="table-target-dot"/>
                        {target.targetId}
                      </td>

                      <td>{num(target.x)} mm</td>
                      <td>{num(target.y)} mm</td>
                      <td>{num(target.speed)} m/s</td>

                      <td>
                        {readableTime(
                          target.lastSeenAt || target.timestamp
                        )}
                      </td>

                      <td>
                        <span className="registry-tag">
                          ACTIVE
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="table-empty">
                      No active radar targets detected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {syncState === "error" && (
            <div className="feed-error">
              <Icon name="alert" size={16}/>
              Firestore request failed: {syncError}
            </div>
          )}

          <div className="registry-note">
            <Icon name="clock" size={15}/>
            Historical Firestore documents remain stored but are
            excluded from the active display when their readings expire.
          </div>
        </section>

        {/* ================= FOOTER ================= */}

        <footer className="dashboard-footer">
          <span>
            <Icon name="shield" size={15}/>
            AUTHENTICATED MONITORING WORKSPACE
          </span>

          <span>
            LoRa-Enabled Multi-Target Human Tracking System · TC-307
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;
