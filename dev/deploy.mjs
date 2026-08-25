/**
 * One-command publish:  npm run deploy  ["your message"]
 *
 * Stages everything, commits, and pushes to every GitHub repo configured on
 * `origin` (both PrepMarket and prepmarket_dashboard). Vercel watches one of
 * them and rebuilds automatically, so the live site updates about a minute
 * later with no dashboard clicking.
 *
 * Add --watch to keep running and publish automatically whenever a file
 * changes (debounced, so a burst of saves becomes one commit).
 */

import { execSync, execFileSync } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const WATCH = args.includes("--watch");
/**
 * --only=<path> stages just that file. The 3-hourly click sync runs unattended,
 * and a blanket `git add -A` would publish whatever half-finished edits happen
 * to be in the folder at the time.
 */
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;
const message = args
  .filter((a) => a !== "--watch" && !a.startsWith("--only="))
  .join(" ").trim();

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe" }).trim();

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function publish(msg) {
  let changed;
  try {
    changed = sh(ONLY ? `git status --porcelain -- "${ONLY}"` : "git status --porcelain");
  } catch (e) {
    console.error("  Not a git repository, or git is unavailable.");
    return false;
  }

  if (changed) {
    // -F - keeps the message safe even if it contains quotes or newlines
    execFileSync("git", ONLY ? ["add", "--", ONLY] : ["add", "-A"], { cwd: ROOT, stdio: "inherit" });
    execFileSync("git", ["commit", "-q", "-F", "-"], {
      cwd: ROOT,
      input: msg || `Update dashboard (${stamp()})`,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log("  committed: " + changed.split("\n").length + " file(s) changed");
  } else {
    console.log("  nothing new to commit");
  }

  // push even with no new commit - a previous run may have failed to reach GitHub
  const ahead = sh("git rev-list --count @{u}..HEAD 2>/dev/null || echo 1");
  if (!changed && ahead === "0") {
    console.log("  already up to date with GitHub - nothing to push");
    return true;
  }

  console.log("  pushing to GitHub...");
  try {
    execFileSync("git", ["push", "origin", "main"], { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error("  PUSH FAILED - see the error above. Nothing was lost; your commit is saved locally.");
    return false;
  }
  console.log("  done. Vercel will rebuild in ~1 minute.");
  return true;
}

if (!WATCH) {
  console.log("");
  publish(message);
  console.log("");
} else {
  console.log("");
  console.log("  Watching for changes. Every save publishes to GitHub -> Vercel.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");

  const IGNORE = /(^|[\\/])(\.git|node_modules|\.vercel)([\\/]|$)|\.env(\.|$)|(^|[\\/])\.c\.js$/;
  let timer = null;
  const queue = new Set();

  watch(ROOT, { recursive: true }, (_event, file) => {
    if (!file || IGNORE.test(file)) return;
    queue.add(file);
    clearTimeout(timer);
    // wait for the flurry of saves to settle before committing
    timer = setTimeout(() => {
      const files = [...queue];
      queue.clear();
      console.log(`  change detected: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""}`);
      publish(`Update ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""}`);
      console.log("");
    }, 4000);
  });
}
