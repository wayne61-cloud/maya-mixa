#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function usage() {
  console.log("Usage: node scripts/configure-runtime.mjs --api https://api.example.com [--app https://app.example.com]");
}

function parseArgs(argv) {
  const out = { api: "", app: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--api") {
      out.api = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (token === "--app") {
      out.app = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return out;
}

function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`Invalid URL: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.api) {
    usage();
    process.exit(1);
  }

  const apiBase = normalizeUrl(args.api);
  const appUrl = normalizeUrl(args.app);

  const output = { apiBase, appUrl };
  const runtimePath = path.resolve(process.cwd(), "config", "runtime.json");
  fs.writeFileSync(runtimePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Updated runtime config: ${runtimePath}`);
  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
