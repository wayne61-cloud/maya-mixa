#!/usr/bin/env node
import process from "node:process";

function parseArgs(argv) {
  const out = { base: "", admin: "admin" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base") {
      out.base = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--admin") {
      out.admin = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return out;
}

function normalizeBase(raw) {
  const value = String(raw || "").trim();
  if (!value || !/^https?:\/\//i.test(value)) {
    throw new Error("Missing or invalid --base URL (expected https://...)");
  }
  return value.replace(/\/+$/, "");
}

async function api(base, method, path, token = "", body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = payload?.detail || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} -> ${response.status}: ${detail}`);
  }
  return payload;
}

function printCheck(name, status, detail = "") {
  const marker = status ? "OK " : "KO ";
  console.log(`${marker} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function ensureAuth(base, adminId) {
  try {
    const login = await api(base, "POST", "/api/auth/login", "", { email: adminId, password: "" });
    return login?.token || "";
  } catch (_) {
    const randomId = `dj_cloud_${Date.now().toString().slice(-8)}`;
    await api(base, "POST", "/api/auth/register", "", {
      email: randomId,
      password: "",
      display_name: "Cloud DJ",
      dj_name: "Cloud DJ",
    });
    const login = await api(base, "POST", "/api/auth/login", "", { email: randomId, password: "" });
    return login?.token || "";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = normalizeBase(args.base);
  const checks = [];

  try {
    const health = await api(base, "GET", "/api/health");
    checks.push({ name: "health", pass: Boolean(health?.ok), detail: `tracks=${health?.tracks ?? "?"} external=${health?.externalTracks ?? "?"}` });
  } catch (error) {
    checks.push({ name: "health", pass: false, detail: String(error.message || error) });
  }

  try {
    const authConfig = await api(base, "GET", "/api/auth/config");
    checks.push({
      name: "auth-config",
      pass: authConfig?.auth?.passwordless === true,
      detail: `passwordless=${String(authConfig?.auth?.passwordless)} label=${authConfig?.auth?.identifierLabel || "n/a"}`,
    });
  } catch (error) {
    checks.push({ name: "auth-config", pass: false, detail: String(error.message || error) });
  }

  let token = "";
  try {
    token = await ensureAuth(base, args.admin || "admin");
    checks.push({ name: "login/register", pass: Boolean(token), detail: token ? "token received" : "no token" });
  } catch (error) {
    checks.push({ name: "login/register", pass: false, detail: String(error.message || error) });
  }

  if (token) {
    try {
      const tracks = await api(base, "GET", "/api/library/tracks?limit=100", token);
      const count = Array.isArray(tracks?.tracks) ? tracks.tracks.length : 0;
      checks.push({ name: "library", pass: Array.isArray(tracks?.tracks), detail: `tracks=${count}` });

      if (count >= 2) {
        const trackA = tracks.tracks[0]?.id;
        const trackB = tracks.tracks[1]?.id;
        const analysis = await api(base, "POST", "/api/transition/analyze", token, {
          track_a_id: trackA,
          track_b_id: trackB,
        });
        const compatibility = analysis?.analysis?.compatibility;
        checks.push({
          name: "transition-ai",
          pass: Number.isFinite(Number(compatibility)),
          detail: `compatibility=${compatibility}`,
        });
      } else {
        checks.push({ name: "transition-ai", pass: true, detail: "skipped (not enough tracks to analyze)" });
      }
    } catch (error) {
      checks.push({ name: "library/transition", pass: false, detail: String(error.message || error) });
    }

    try {
      const dashboard = await api(base, "GET", "/api/account/dashboard", token);
      const tips = Array.isArray(dashboard?.aiTips) ? dashboard.aiTips.length : 0;
      const top = Array.isArray(dashboard?.topTracks) ? dashboard.topTracks.length : 0;
      checks.push({
        name: "account-dashboard",
        pass: dashboard?.profile?.id && dashboard?.summary,
        detail: `tips=${tips} topTracks=${top} cloudDb=${dashboard?.cloud?.dbExists}`,
      });
    } catch (error) {
      checks.push({ name: "account-dashboard", pass: false, detail: String(error.message || error) });
    }

    try {
      const cloud = await api(base, "GET", "/api/cloud/status", token);
      checks.push({
        name: "cloud-status",
        pass: Boolean(cloud?.cloud?.dbExists),
        detail: `env=${cloud?.cloud?.environment} db=${cloud?.cloud?.dbPath}`,
      });
    } catch (error) {
      checks.push({ name: "cloud-status", pass: false, detail: String(error.message || error) });
    }

    try {
      const providers = await api(base, "GET", "/api/music/providers", token);
      checks.push({
        name: "streaming-linking",
        pass: providers?.enabled === false && Object.keys(providers?.providers || {}).length === 0,
        detail: providers?.enabled === false ? "disabled (expected)" : "unexpectedly enabled",
      });
    } catch (error) {
      checks.push({ name: "streaming-linking", pass: false, detail: String(error.message || error) });
    }

    try {
      const unified = await api(base, "GET", "/api/search/unified?q=anyma&limit=20", token);
      const localCount = Array.isArray(unified?.local) ? unified.local.length : 0;
      const globalCount = Array.isArray(unified?.global) ? unified.global.length : 0;
      const sources = [...new Set((unified?.global || []).map((row) => row?.source).filter(Boolean))];
      checks.push({
        name: "global-search",
        pass: globalCount > 0 || localCount > 0,
        detail: `local=${localCount} global=${globalCount} sources=${sources.join(",") || "none"}`,
      });
    } catch (error) {
      checks.push({ name: "global-search", pass: false, detail: String(error.message || error) });
    }

    try {
      const seratoCaps = await api(base, "GET", "/api/serato/capabilities", token);
      const seratoStatus = await api(base, "GET", "/api/serato/status", token);
      checks.push({
        name: "serato-bridge",
        pass: Array.isArray(seratoCaps?.modes) && typeof seratoStatus?.status === "string",
        detail: `status=${seratoStatus?.status || "unknown"} modes=${(seratoCaps?.modes || []).length}`,
      });
    } catch (error) {
      checks.push({ name: "serato-bridge", pass: false, detail: String(error.message || error) });
    }

    try {
      const ai = await api(base, "GET", "/api/ai/status", token);
      checks.push({
        name: "ai-status",
        pass: ai?.localModelActive === true,
        detail: `local=${ai?.localModelActive} openai=${ai?.openaiEnabled}`,
      });
    } catch (error) {
      checks.push({ name: "ai-status", pass: false, detail: String(error.message || error) });
    }
  }

  console.log("");
  for (const check of checks) {
    printCheck(check.name, check.pass, check.detail);
  }

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    process.exitCode = 1;
    console.error(`\nSmoke test failed: ${failed.length} check(s)`);
    return;
  }
  console.log("\nSmoke test passed.");
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
