#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const out = {
    arch: "arm64",
    skipBuild: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--arch") {
      out.arch = String(argv[i + 1] || "").trim() || out.arch;
      i += 1;
    } else if (token === "--skip-build") {
      out.skipBuild = true;
    }
  }
  return out;
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd || process.cwd(),
    env: process.env,
  });
}

function normalizeArch(arch) {
  const value = String(arch || "").trim().toLowerCase();
  if (["arm64", "x64", "universal"].includes(value)) return value;
  throw new Error(`Unsupported arch "${arch}". Expected arm64, x64, or universal.`);
}

function ensureExists(targetPath, hint) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing expected file: ${targetPath}${hint ? ` (${hint})` : ""}`);
  }
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("scripts/macos-repair-build.mjs must run on macOS.");
  }

  const args = parseArgs(process.argv.slice(2));
  const arch = normalizeArch(args.arch);

  const root = process.cwd();
  const pkgPath = path.join(root, "package.json");
  ensureExists(pkgPath, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  const productName = String((pkg.build && pkg.build.productName) || pkg.productName || pkg.name || "App").trim();
  const version = String(pkg.version || "0.0.0").trim();
  const releaseDir = path.join(root, "release");
  const macDir = path.join(releaseDir, `mac-${arch}`);
  const appPath = path.join(macDir, `${productName}.app`);
  const zipPath = path.join(releaseDir, `${productName}-${version}-${arch}-mac.zip`);
  const dmgPath = path.join(releaseDir, `${productName}-${version}-${arch}.dmg`);
  const zipBlockmapPath = `${zipPath}.blockmap`;
  const dmgBlockmapPath = `${dmgPath}.blockmap`;

  if (!args.skipBuild) {
    run("npx", ["electron-builder", "--mac", `--${arch}`], { cwd: root });
  }

  ensureExists(appPath, "electron-builder output");

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-mixa-mac-"));
  const stagedAppPath = path.join(stageDir, `${productName}.app`);
  const dmgSourceDir = path.join(stageDir, "dmg-src");
  fs.mkdirSync(dmgSourceDir, { recursive: true });

  run("ditto", [appPath, stagedAppPath]);
  run("xattr", ["-cr", stagedAppPath]);
  run("codesign", ["--force", "--deep", "--sign", "-", stagedAppPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", stagedAppPath]);

  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  if (fs.existsSync(dmgPath)) fs.rmSync(dmgPath, { force: true });
  if (fs.existsSync(zipBlockmapPath)) fs.rmSync(zipBlockmapPath, { force: true });
  if (fs.existsSync(dmgBlockmapPath)) fs.rmSync(dmgBlockmapPath, { force: true });

  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", stagedAppPath, zipPath]);
  run("ditto", [stagedAppPath, path.join(dmgSourceDir, `${productName}.app`)]);
  run("hdiutil", ["create", "-volname", productName, "-srcfolder", dmgSourceDir, "-ov", "-format", "UDZO", dmgPath]);

  run("shasum", ["-a", "256", zipPath, dmgPath]);

  console.log("");
  console.log("macOS release repaired successfully:");
  console.log(`- ${zipPath}`);
  console.log(`- ${dmgPath}`);
}

try {
  main();
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
}
