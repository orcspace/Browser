const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
function walk(dir) {
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, file.name);
    if (file.isDirectory()) walk(full);
    else if (/\.(cjs|js|mjs)$/.test(file.name))
      execFileSync(process.execPath, ["--check", full], { stdio: "inherit" });
  }
}
walk("src");
walk("scripts");
walk("tests");
require("../src/core/config.cjs").validateConfig(
  require("../config/default.json"),
);
console.log("Syntax and default configuration valid.");
