import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";

const API_BASE = ""; // same-origin on Netlify

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem("sims_token") || "");
  const isAuthed = Boolean(token);

  const saveToken = (t) => {
    if (t) localStorage.setItem("sims_token", t);
    else localStorage.removeItem("sims_token");
    setToken(t || "");
  };

  return { token, isAuthed, saveToken };
}

async function apiFetch(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `HTTP ${res.status}`;
    const detail = data && data.detail ? `: ${data.detail}` : "";
    throw new Error(`${msg}${detail}`);
  }

  return data;
}

function Layout({ children, onLogout, isAuthed }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <strong>SIMS v6.2</strong>
          <nav style={{ display: "flex", gap: 10 }}>
            <Link to="/">Login</Link>
            <Link to="/evaluate">Оценка</Link>
            <Link to="/risk">Риск (HR/Admin)</Link>
          </nav>
        </div>
        {isAuthed ? (
          <button onClick={onLogout}>Изход</button>
        ) : (
          <span style={{ opacity: 0.7 }}>Не сте влезли</span>
        )}
      </header>
      <hr />
      {children}
      <footer style={{ marginTop: 24, opacity: 0.6, fontSize: 12 }}>
        API: <code>/api</code>
      </footer>
    </div>
  );
}

function LoginPage({ auth }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const doLogin = async (e) => {
    e.preventDefault();
    setStatus("Влизане...");
    try {
      const { token } = await apiFetch("/api/login", { method: "POST", body: { email, password } });
      auth.saveToken(token);
      setStatus("OK");
      nav("/evaluate");
    } catch (err) {
      setStatus(String(err.message || err));
    }
  };

  return (
    <div>
      <h2>Вход</h2>
      <form onSubmit={doLogin} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Парола
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button type="submit">Влез</button>
        {status ? <div style={{ whiteSpace: "pre-wrap" }}>{status}</div> : null}
      </form>
      <p style={{ opacity: 0.7 }}>
        Ако получавате грешка “Missing env vars”, добавете променливите в Netlify → Site settings → Environment variables.
      </p>
    </div>
  );
}

function EvaluatePage({ auth }) {
  const [employeeId, setEmployeeId] = useState("");
  const [score, setScore] = useState("3.0");
  const [status, setStatus] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setStatus("Запис...");
    try {
      await apiFetch("/api/evaluations", {
        token: auth.token,
        method: "POST",
        body: { employee_id: employeeId, overall_score: Number(score) }
      });
      setStatus("Записано.");
    } catch (err) {
      setStatus(String(err.message || err));
    }
  };

  return (
    <div>
      <h2>Седмична оценка</h2>
      {!auth.isAuthed ? (
        <p>Трябва да сте влезли.</p>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <label>
            Employee ID
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Overall score (0-5)
            <input value={score} onChange={(e) => setScore(e.target.value)} style={{ width: "100%" }} />
          </label>
          <button type="submit">Запиши</button>
          {status ? <div style={{ whiteSpace: "pre-wrap" }}>{status}</div> : null}
        </form>
      )}
    </div>
  );
}

function RiskPage({ auth }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");

  const load = async () => {
    setStatus("Зареждане...");
    try {
      const data = await apiFetch("/api/analytics/department-risk", { token: auth.token });
      setRows(Array.isArray(data) ? data : []);
      setStatus("");
    } catch (err) {
      setStatus(String(err.message || err));
    }
  };

  useEffect(() => {
    if (auth.isAuthed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isAuthed]);

  const counts = useMemo(() => {
    const c = { low: 0, high: 0, critical: 0, unknown: 0 };
    for (const r of rows) {
      if (r.severity === "high") c.high++;
      else if (r.severity === "critical") c.critical++;
      else if (r.severity === "low") c.low++;
      else c.unknown++;
    }
    return c;
  }, [rows]);

  return (
    <div>
      <h2>Активни предупреждения</h2>
      {!auth.isAuthed ? <p>Трябва да сте влезли.</p> : null}
      <button onClick={load} disabled={!auth.isAuthed}>Обнови</button>
      {status ? <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{status}</div> : null}
      <div style={{ marginTop: 12 }}>
        <div>High: {counts.high} | Critical: {counts.critical} | Low: {counts.low} | Unknown: {counts.unknown}</div>
      </div>
      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Employee</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Severity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>{r.employee_id}</td>
              <td style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>{r.severity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const nav = useNavigate();

  const logout = () => {
    auth.saveToken("");
    nav("/");
  };

  return (
    <Layout onLogout={logout} isAuthed={auth.isAuthed}>
      <Routes>
        <Route path="/" element={<LoginPage auth={auth} />} />
        <Route path="/evaluate" element={<EvaluatePage auth={auth} />} />
        <Route path="/risk" element={<RiskPage auth={auth} />} />
      </Routes>
    </Layout>
  );
}
