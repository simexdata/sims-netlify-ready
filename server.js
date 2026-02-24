import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

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

/* ================= AUTH ================= */
function auth(req, res, next) {
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

// Refresh role from DB each request (prevents "stale role" for 8h)
async function hydrateUser(req, res, next) {
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
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

// Supervisor can evaluate only their team
async function assertCanEvaluate(req, employeeId) {
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

/* ================= LOGIN ================= */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/api/login", loginLimiter, async (req, res) => {
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

  // Shorter token. Role comes from DB via hydrateUser()
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
    const { employee_id, overall_score } = req.body;

    if (!employee_id || typeof overall_score !== "number") {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const allowed = await assertCanEvaluate(req, employee_id);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const week_start = getWeekStartDate(new Date());

    const { error: insErr } = await supabase.from("employee_weekly_evaluations").insert([
      { employee_id, week_start, overall_score }
    ]);

    if (insErr) {
      // If unique(employee_id, week_start) triggers, you'll see it here
      return res.status(500).json({ message: "Insert failed", detail: insErr.message });
    }

    const { data: last3 = [] } = await supabase
      .from("employee_weekly_evaluations")
      .select("overall_score, created_at")
      .eq("employee_id", employee_id)
      .order("created_at", { ascending: false })
      .limit(3);

    const lowCount = last3.filter(e => Number(e.overall_score) <= 2.5).length;

    if (lowCount >= 2) {
      // Your choice: escalate to HIGH when pattern detected
      const severity = lowCount >= 3 ? "critical" : "high";

      await supabase.from("warning_letters").insert([
        { employee_id, severity, status: "active" }
      ]);
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
  async (req, res) => {
    const { data, error } = await supabase
      .from("warning_letters")
      .select("employee_id, severity")
      .eq("status", "active");

    if (error) return res.status(500).json({ message: "Query failed", detail: error.message });

    res.json(data);
  }
);

app.listen(process.env.PORT || 5000, () => {
  console.log("Simex HR API v2 running");
});