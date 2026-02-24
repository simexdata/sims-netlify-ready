import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import serverless from "serverless-http";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// Netlify Functions mount path: /.netlify/functions/api
app.use((req, _res, next) => {
  if (req.url.startsWith("/.netlify/functions/api")) {
    req.url = req.url.replace("/.netlify/functions/api", "") || "/";
  }
  next();
});

app.use(helmet());

const allowedOrigin = process.env.FRONTEND_URL || true;
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  // SERVICE ROLE key must stay server-side only
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _supabase;
}

/* ================= UTILS ================= */
function getWeekStartDate(d = new Date()) {
  // Monday-based week start in UTC
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0..6 (Sun..Sat)
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function assertEnv(res) {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!JWT_SECRET) missing.push("JWT_SECRET");
  if (missing.length) {
    res.status(500).json({ message: "Missing env vars", missing });
    return false;
  }
  return true;
}

/* ================= AUTH ================= */
function auth(req, res, next) {
  if (!assertEnv(res)) return;
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// Refresh role from DB each request
async function hydrateUser(req, res, next) {
  const supabase = getSupabase();
  const { data: fresh, error } = await supabase
    .from("employees")
    .select("id, role, manager_id")
    .eq("id", req.user.id)
    .single();

  if (error || !fresh) return res.status(401).json({ message: "Unauthorized" });

  req.user.role = fresh.role;
  req.user.manager_id = fresh.manager_id;
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

// Supervisor can evaluate only their team
async function assertCanEvaluate(req, employeeId) {
  const supabase = getSupabase();
  if (req.user.role === "admin" || req.user.role === "hr") return true;

  if (req.user.role === "supervisor") {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, manager_id")
      .eq("id", employeeId)
      .single();

    return Boolean(emp && emp.manager_id === req.user.id);
  }

  return false;
}

/* ================= HEALTH ================= */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/* ================= LOGIN ================= */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/api/login", loginLimiter, async (req, res) => {
  if (!assertEnv(res)) return;

  const supabase = getSupabase();

  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  const { data: user } = await supabase
    .from("employees")
    .select("id, role, manager_id, password_hash")
    .eq("email", email)
    .single();

  if (!user) return res.status(400).json({ message: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ message: "Invalid credentials" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "1h" });

  res.json({ token });
});

/* ================= EVALUATIONS ================= */
app.post(
  "/api/evaluations",
  auth,
  hydrateUser,
  requireRole(["supervisor", "hr", "admin"]),
  async (req, res) => {
    const supabase = getSupabase();
    const { employee_id, overall_score } = req.body;

    if (!employee_id || typeof overall_score !== "number") {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const allowed = await assertCanEvaluate(req, employee_id);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const week_start = getWeekStartDate(new Date());

    const { error: insErr } = await supabase
      .from("employee_weekly_evaluations")
      .insert([{ employee_id, week_start, overall_score }]);

    if (insErr) {
      return res.status(500).json({ message: "Insert failed", detail: insErr.message });
    }

    const { data: last3 = [] } = await supabase
      .from("employee_weekly_evaluations")
      .select("overall_score, created_at")
      .eq("employee_id", employee_id)
      .order("created_at", { ascending: false })
      .limit(3);

    const lowCount = last3.filter((e) => Number(e.overall_score) <= 2.5).length;

    if (lowCount >= 2) {
      const severity = lowCount >= 3 ? "critical" : "high";
      await supabase.from("warning_letters").insert([{ employee_id, severity, status: "active" }]);
    }

    res.json({ success: true });
  }
);

/* ================= ANALYTICS ================= */
app.get(
  "/api/analytics/department-risk",
  auth,
  hydrateUser,
  requireRole(["hr", "admin"]),
  async (_req, res) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("warning_letters")
      .select("employee_id, severity")
      .eq("status", "active");

    if (error) return res.status(500).json({ message: "Query failed", detail: error.message });

    res.json(data);
  }
);

export const handler = serverless(app);
