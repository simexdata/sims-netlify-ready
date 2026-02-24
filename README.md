# SIMS v6.2 — Vite + Netlify (Frontend) + Netlify Function (API)

Този пакет е подготвен да се качи директно в **Netlify** като Git repo или ZIP.

## 1) Локално
```bash
npm ci
npm run dev
```

## 2) Netlify Deploy
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`

### Environment variables (Netlify → Site settings → Environment variables)
Задължителни:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`  (само server-side; НЕ я слагайте във фронтенда)
- `JWT_SECRET`

Препоръчителни:
- `FRONTEND_URL` (напр. `https://<site>.netlify.app`) — за CORS

API-то е достъпно на:
- `/api/login`
- `/api/evaluations`
- `/api/analytics/department-risk`
- `/api/health`

Netlify автоматично пренасочва `/api/*` към `/.netlify/functions/api/*` (виж `netlify.toml`).

## 3) Supabase
- Таблиците трябва да съществуват: `employees`, `employee_weekly_evaluations`, `warning_letters`.
- Приложете `schema.sql` в Supabase SQL editor (добавя constraints + RLS политики за evaluations).

## 4) Ръчен deploy (без Git)
1) `npm run build`
2) Качи **целия проект** (не само `dist/`) ако искаш да работят Functions.
   - Ако качиш само `dist/`, ще имаш само статичен сайт без API.

---

### Бележка
Файлът `server.js` е оставен като референция (оригиналният Express вариант). В Netlify се използва `netlify/functions/api.js`.
