import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2];
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (command === "check") {
  const files = ["index.js"];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(js|mjs)$/.test(item.name)) files.push(path);
    }
  };
  for (const dir of [
    "adedonha",
    "controllers",
    "routes",
    "config",
    "scripts",
    "tests",
  ])
    walk(dir);
  for (const file of files) {
    const check = spawnSync(process.execPath, ["--check", file], {
      stdio: "inherit",
    });
    if (check.status !== 0) process.exit(check.status ?? 1);
  }
  console.log(
    `Syntax verified: ${files.length} JavaScript files. No compilation is required.`,
  );
} else if (command === "install") {
  // npm runs this lifecycle after installing dependencies; do not recursively run npm install.
  console.log(
    `Dependencies installed. Node ${process.version}. Start with npm start.`,
  );
} else if (command === "status") {
  console.log(
    JSON.stringify(
      {
        node: process.version,
        port: process.env.PORT || 3002,
        firebase_project: "adedonha-stop",
        credentials_present: !!(
          process.env.ADEDONHA_FIREBASE_CLIENT_EMAIL &&
          process.env.ADEDONHA_FIREBASE_PRIVATE_KEY
        ),
        stores_tested_live: false,
      },
      null,
      2,
    ),
  );
} else {
  for (const [name, script] of Object.entries(pkg.scripts))
    console.log(`${name.padEnd(20)} ${script}`);
}
