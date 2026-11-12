import { spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:net";

const app = process.env.HEROKU_APP || "heroku-backend-nodejs";
const args = process.argv.slice(2);
const command = args.shift() || "help";
const executable = name => process.platform === "win32" && ["npm", "npx", "heroku"].includes(name) ? `${name}.cmd` : name;

function run(name, params = []) {
  const result = spawnSync(executable(name), params, { stdio: "inherit", shell: process.platform === "win32" && ["npm", "npx", "heroku"].includes(name) });
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

function capture(name, params = []) {
  try { return execFileSync(executable(name), params, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function repository() {
  if (capture("git", ["rev-parse", "--is-inside-work-tree"]) !== "true") throw Error("Run inside the backend Git repository.");
}

function ensureHerokuRemote() {
  const remote = capture("git", ["remote", "get-url", "heroku"]);
  if (remote && remote.includes(`${app}.git`)) return;
  run("heroku", ["git:remote", "-a", app]);
}

function github() {
  repository();
  if (!capture("git", ["remote", "get-url", "origin"])) throw Error("GitHub origin remote is missing.");
  run("git", ["add", "-A"]);
  if (capture("git", ["status", "--porcelain"])) run("git", ["commit", "-m", args.join(" ") || "chore: deploy backend"]);
  run("git", ["push", "origin", "HEAD"]);
}

async function assertPortAvailable(port) {
  const available = await new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
  if (!available) throw Error(`Port ${port} is already in use. Stop the existing server first.`);
}

async function main() {
  switch (command) {
    case "dev":
      await assertPortAvailable(Number(process.env.PORT || 3002));
      run("node", ["--watch", "index.js"]);
      break;
    case "login": run("heroku", ["login"]); run("npx", ["firebase-tools", "login"]); break;
    case "heroku-login": run("heroku", ["login"]); break;
    case "heroku-link": ensureHerokuRemote(); break;
    case "heroku-open": run("heroku", ["open", "-a", app]); break;
    case "heroku-logs": run("heroku", ["logs", "--tail", "-a", app]); break;
    case "firebase-login": run("npx", ["firebase-tools", "login"]); break;
    case "firebase-logout": run("npx", ["firebase-tools", "logout"]); break;
    case "firebase-status": run("npx", ["firebase-tools", "login:list"]); break;
    case "health": {
      const url = command === "health" ? process.env.BACKEND_LOCAL_URL || "http://localhost:3002/api/v1/adedonha/health" : process.env.BACKEND_PROD_URL || `https://${app}.herokuapp.com/api/v1/adedonha/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try { const result = await fetch(url, { signal: controller.signal }); process.stdout.write(`${result.status} ${url}\n${await result.text()}\n`); if (!result.ok) process.exitCode = 1; }
      finally { clearTimeout(timeout); }
      break;
    }
    case "health-prod": {
      const url = process.env.BACKEND_PROD_URL || `https://${app}.herokuapp.com/api/v1/adedonha/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try { const result = await fetch(url, { signal: controller.signal }); process.stdout.write(`${result.status} ${url}\n${await result.text()}\n`); if (!result.ok) process.exitCode = 1; }
      finally { clearTimeout(timeout); }
      break;
    }
    case "github": github(); break;
    case "heroku": repository(); ensureHerokuRemote(); run("git", ["push", "heroku", "HEAD:main"]); break;
    case "deploy":
      run("npm", ["test"]);
      run("npm", ["run", "build"]);
      github();
      ensureHerokuRemote();
      run("git", ["push", "heroku", "HEAD:main"]);
      break;
    case "status": run("git", ["status", "--short", "--branch"]); run("git", ["remote", "-v"]); break;
    case "help": process.stdout.write(`Backend Command Hub\n\nWindow: npm run hub\nInstall: npm install\nServer: npm start | npm run dev\nQuality: npm test | npm run build | npm run lint | npm run format\nLogin: npm run heroku:login | npm run firebase:login\nDeploy: npm run deploy -- "message" | npm run deploy:github | npm run deploy:heroku\nStatus: npm run status | npm run health | npm run health:prod\nHeroku app: ${app}\n`); break;
    default: throw Error(`Unknown command: ${command}`);
  }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
