#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    api: "",
    token: "",
    history: "",
    intervalMs: 1500,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--api" && value) {
      out.api = String(value);
      i += 1;
      continue;
    }
    if (key === "--token" && value) {
      out.token = String(value);
      i += 1;
      continue;
    }
    if (key === "--history" && value) {
      out.history = String(value);
      i += 1;
      continue;
    }
    if (key === "--interval" && value) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 300) out.intervalMs = Math.floor(n);
      i += 1;
      continue;
    }
    if (key === "--verbose") {
      out.verbose = true;
    }
  }
  return out;
}

function expandHome(inputPath) {
  if (!inputPath) return "";
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function normalizeBase(api) {
  return String(api || "").trim().replace(/\/+$/, "");
}

function walkFiles(root, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function parseHistoryLine(line) {
  const clean = String(line || "").trim();
  if (!clean) return null;
  try {
    const maybe = JSON.parse(clean);
    if (maybe && typeof maybe === "object") return maybe;
  } catch (_) {
    // Not JSON, fallback parser below.
  }

  if (clean.includes(" - ")) {
    const [artist, ...rest] = clean.split(" - ");
    const title = rest.join(" - ").trim();
    return {
      deck: "A",
      track: {
        artist: artist.trim() || "Unknown Artist",
        title: title || clean.slice(0, 180),
      },
    };
  }

  return {
    deck: "A",
    track: {
      artist: "Unknown Artist",
      title: clean.slice(0, 180),
    },
  };
}

async function apiJson(base, token, method, route, payload) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${method} ${route} failed: ${res.status} ${body}`);
  }
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const base = normalizeBase(args.api);
  const token = String(args.token || "").trim();
  const historyPath = path.resolve(expandHome(args.history));

  if (!base || !token || !historyPath) {
    console.error(
      "Usage: node scripts/serato-history-push.mjs --api https://maya-mixa-cloud.onrender.com --token <AUTH_TOKEN> --history ~/Music/_Serato_/History/Sessions [--interval 1500] [--verbose]"
    );
    process.exit(1);
  }

  if (!fs.existsSync(historyPath)) {
    console.error(`History path not found: ${historyPath}`);
    process.exit(1);
  }

  await apiJson(base, token, "POST", "/api/serato/connect", { mode: "push" });
  console.log(`Connected push bridge -> ${base}`);
  console.log(`Watching Serato history folder: ${historyPath}`);

  const fileOffsets = new Map();
  let running = true;
  const stop = async () => {
    if (!running) return;
    running = false;
    try {
      await apiJson(base, token, "POST", "/api/serato/disconnect", {});
    } catch (_) {
      // Best effort.
    }
    console.log("Relay stopped.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    const files = walkFiles(historyPath, []);
    files.sort((a, b) => {
      const sa = fs.statSync(a).mtimeMs;
      const sb = fs.statSync(b).mtimeMs;
      return sb - sa;
    });

    const latest = files[0];
    if (!latest) {
      await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
      continue;
    }

    const content = fs.readFileSync(latest, "utf8");
    const prevOffset = fileOffsets.get(latest) || 0;
    const safeOffset = Math.min(prevOffset, content.length);
    const delta = content.slice(safeOffset);
    fileOffsets.set(latest, content.length);

    const lines = delta
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const payload = parseHistoryLine(line);
      if (!payload) continue;
      try {
        await apiJson(base, token, "POST", "/api/serato/push", {
          source: "serato_history_relay",
          payload,
        });
        if (args.verbose) {
          const title = payload?.track?.title || payload?.deckA?.title || payload?.deckB?.title || "unknown";
          console.log(`Pushed: ${title}`);
        }
      } catch (error) {
        console.error(String(error.message || error));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
