#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const indexPath = path.join(root, "index.html");
const appPath = path.join(root, "app.js");

const indexHtml = fs.readFileSync(indexPath, "utf8");
const appJs = fs.readFileSync(appPath, "utf8");

const buttonIds = [];
for (const match of indexHtml.matchAll(/<button[^>]*\sid="([^"]+)"[^>]*>/gim)) {
  buttonIds.push(match[1]);
}

const submitMap = new Map();
for (const formMatch of indexHtml.matchAll(/<form[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gim)) {
  const formId = formMatch[1];
  const formBody = formMatch[2] || "";
  for (const buttonMatch of formBody.matchAll(/<button[^>]*\sid="([^"]+)"[^>]*\stype="submit"[^>]*>/gim)) {
    submitMap.set(buttonMatch[1], formId);
  }
}

const missing = [];
const rows = [];
for (const buttonId of [...new Set(buttonIds)]) {
  const hasRef = appJs.includes(`${buttonId}: document.getElementById("${buttonId}")`);
  const hasDirectBinding = new RegExp(`on\\(el\\.${buttonId},|el\\.${buttonId}\\.addEventListener`, "m").test(appJs);
  const submitFormId = submitMap.get(buttonId) || "";
  const hasSubmitBinding = submitFormId
    ? new RegExp(`on\\(el\\.${submitFormId},\\s*"submit"`, "m").test(appJs)
    : false;
  const wired = hasDirectBinding || hasSubmitBinding;

  rows.push({
    buttonId,
    hasRef,
    hasDirectBinding,
    hasSubmitBinding,
    submitFormId,
    wired,
  });

  if (!hasRef || !wired) {
    missing.push({
      buttonId,
      reason: `${hasRef ? "" : "missing el ref"}${!hasRef && !wired ? " + " : ""}${wired ? "" : "missing binding"}`,
    });
  }
}

const delegatedSelectors = [
  "[data-local-analyze]",
  "[data-local-remove]",
  "[data-external-open]",
  "[data-external-analyze]",
  "[data-external-import]",
  "[data-session-add]",
  "[data-session-remove]",
  "[data-session-move]",
  "[data-remove-list-item]",
  "[data-admin-save]",
];

const delegatedMissing = delegatedSelectors.filter((selector) => !appJs.includes(selector));

console.log("UI button wiring audit");
console.log("======================");
for (const row of rows) {
  const mode = row.hasSubmitBinding ? `form-submit(${row.submitFormId})` : row.hasDirectBinding ? "direct" : "none";
  console.log(`${row.buttonId.padEnd(28)} ref=${row.hasRef ? "yes" : "no "} binding=${mode}`);
}
if (delegatedMissing.length) {
  console.log("");
  console.log("Missing delegated selectors:");
  for (const selector of delegatedMissing) console.log(`- ${selector}`);
}

if (missing.length || delegatedMissing.length) {
  console.error("");
  console.error("FAIL: UI wiring gaps detected.");
  for (const item of missing) {
    console.error(`- ${item.buttonId}: ${item.reason}`);
  }
  process.exit(1);
}

console.log("");
console.log("PASS: all static button ids are wired.");
