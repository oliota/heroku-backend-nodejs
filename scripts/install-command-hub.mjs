import { readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = {
  "----": "echo ---------- SETUP ----------",
  "hub": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop-hub.ps1",
  "gui": "npm run hub",
  "start": "node index.js",
  "dev": "node scripts/hub.mjs dev",
  "run": "npm start",
  "debug": "node --inspect index.js",
  "-----": "echo ---------- QUALITY ----------",
  "test": "node --test tests/*.test.js",
  "build": "node scripts/commands.js check",
  "lint": "node scripts/commands.js check",
  "format": "prettier --write adedonha tests/*.js scripts/*.js docs/ADEDONHA_FRONTEND_INTEGRATION.md data/adedonhaRules.json",
  "------": "echo ---------- AUTH / DEPLOY ----------",
  "heroku:login": "node scripts/hub.mjs heroku-login",
  "heroku:link": "node scripts/hub.mjs heroku-link",
  "heroku:open": "node scripts/hub.mjs heroku-open",
  "heroku:logs": "node scripts/hub.mjs heroku-logs",
  "firebase:login": "node scripts/hub.mjs firebase-login",
  "firebase:logout": "node scripts/hub.mjs firebase-logout",
  "firebase:status": "node scripts/hub.mjs firebase-status",
  "deploy": "node scripts/hub.mjs deploy",
  "deploy:github": "node scripts/hub.mjs github",
  "deploy:heroku": "node scripts/hub.mjs heroku",
  "heroku:push": "node scripts/hub.mjs heroku",
  "health": "node scripts/hub.mjs health",
  "health:prod": "node scripts/hub.mjs health-prod",
  "status": "node scripts/hub.mjs status",
  "logs": "node scripts/hub.mjs heroku-logs",
  "list": "npm run",
  "help": "node scripts/hub.mjs help"
};
pkg.scripts = { ...pkg.scripts, ...scripts };
await writeFile(new URL("../package.json", import.meta.url), `${JSON.stringify(pkg, null, 2)}\n`);
process.stdout.write("Backend Command Hub installed.\n");
