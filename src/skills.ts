import { Command } from "commander";
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const REPO_OWNER = "readwiseio";
const REPO_NAME = "readwise-skills";
const SKILLS_SUBDIR = "skills";
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const GITHUB_RAW = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master`;

/** Local cache directory for fetched skills */
function cacheDir(): string {
  return join(homedir(), ".readwise", "skills-cache");
}

/** Staleness threshold — refetch if cache is older than this */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function cacheMetaPath(): string {
  return join(cacheDir(), ".fetched_at");
}

async function isCacheFresh(): Promise<boolean> {
  const metaPath = cacheMetaPath();
  if (!existsSync(metaPath)) return false;
  try {
    const ts = Number(await readFile(metaPath, "utf-8"));
    return Date.now() - ts < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function touchCache(): Promise<void> {
  await writeFile(cacheMetaPath(), String(Date.now()));
}

/** Fetch the list of skill directory names from GitHub API */
async function fetchSkillNames(): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/contents/${SKILLS_SUBDIR}`, {
    headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "readwise-cli" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
}

/** Fetch a single SKILL.md from GitHub */
async function fetchSkillFile(skillName: string): Promise<string> {
  const url = `${GITHUB_RAW}/${SKILLS_SUBDIR}/${skillName}/SKILL.md`;
  const res = await fetch(url, { headers: { "User-Agent": "readwise-cli" } });
  if (!res.ok) throw new Error(`Failed to fetch ${skillName}: ${res.status}`);
  return res.text();
}

/** Fetch all skills from GitHub and write to cache */
async function refreshCache(): Promise<string[]> {
  const names = await fetchSkillNames();
  const cache = cacheDir();

  // Clear old cache
  if (existsSync(cache)) await rm(cache, { recursive: true });
  await mkdir(cache, { recursive: true });

  // Fetch all in parallel
  const results = await Promise.allSettled(
    names.map(async (name) => {
      const content = await fetchSkillFile(name);
      const dir = join(cache, name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), content);
      return name;
    })
  );

  const fetched = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);

  await touchCache();
  return fetched;
}

/** Get cached skill names, refreshing if stale */
async function getSkillNames(forceRefresh: boolean): Promise<string[]> {
  if (!forceRefresh && (await isCacheFresh())) {
    return listCachedSkills();
  }
  try {
    return await refreshCache();
  } catch (err) {
    // Fall back to cache if network fails
    const cached = await listCachedSkills();
    if (cached.length > 0) {
      console.error(`\x1b[33mWarning: Could not fetch from GitHub (${(err as Error).message}), using cached skills.\x1b[0m`);
      return cached;
    }
    throw err;
  }
}

async function listCachedSkills(): Promise<string[]> {
  const cache = cacheDir();
  if (!existsSync(cache)) return [];
  const entries = await readdir(cache, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(cache, e.name, "SKILL.md")))
    .map((e) => e.name);
}

async function readSkillFrontmatter(skillName: string): Promise<{ name?: string; description?: string }> {
  const content = await readFile(join(cacheDir(), skillName, "SKILL.md"), "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  }
  return fm;
}

/** Known agent platforms and their skills directories */
const PLATFORMS: Record<string, { name: string; path: string }> = {
  claude: { name: "Claude Code", path: join(homedir(), ".claude", "skills") },
  codex: { name: "Codex CLI", path: join(homedir(), ".codex", "skills") },
  opencode: { name: "OpenCode", path: join(homedir(), ".opencode", "skills") },
};

/** Interactive checkbox picker — returns selected items */
async function pickSkills(
  names: string[],
  descriptions: Map<string, string>
): Promise<string[] | null> {
  const selected = new Set<string>(names.filter((n) => n === "readwise-cli"));
  let cursor = 0;

  const render = () => {
    // Move cursor up to overwrite previous render
    process.stderr.write(`\x1b[${names.length + 2}A\x1b[J`);
    process.stderr.write("  Select skills to install (space toggle, a all/none, enter confirm):\n\n");
    for (let i = 0; i < names.length; i++) {
      const check = selected.has(names[i]!) ? "\x1b[32m✔\x1b[0m" : " ";
      const pointer = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
      const desc = descriptions.get(names[i]!) || "";
      const descText = desc ? `  \x1b[2m${desc}\x1b[0m` : "";
      process.stderr.write(`  ${pointer} [${check}] ${names[i]}${descText}\n`);
    }
  };

  // Initial render (print blank lines first so the upward cursor move works)
  process.stderr.write("\n".repeat(names.length + 2));
  render();

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive: install all
      resolve(names);
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (data: Buffer) => {
      const s = data.toString();

      if (s === "\r" || s === "\n") {
        // Enter — confirm
        cleanup();
        resolve([...selected]);
        return;
      }
      if (s === "\x03" || s === "\x1b") {
        // Ctrl+C or Escape — cancel
        cleanup();
        resolve(null);
        return;
      }
      if (s === " ") {
        // Space — toggle current
        const name = names[cursor]!;
        if (selected.has(name)) selected.delete(name);
        else selected.add(name);
        render();
        return;
      }
      if (s === "a") {
        // 'a' — toggle all/none
        if (selected.size === names.length) selected.clear();
        else names.forEach((n) => selected.add(n));
        render();
        return;
      }
      if (s === "\x1b[A" || s === "k") {
        // Up
        cursor = (cursor - 1 + names.length) % names.length;
        render();
        return;
      }
      if (s === "\x1b[B" || s === "j") {
        // Down
        cursor = (cursor + 1) % names.length;
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };

    process.stdin.on("data", onData);
  });
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Manage Readwise skills for AI agents");

  skills
    .command("list")
    .description("List available skills (fetched from github.com/readwiseio/readwise-skills)")
    .option("--refresh", "Force refresh from GitHub")
    .action(async (opts: { refresh?: boolean }) => {
      try {
        const names = await getSkillNames(!!opts.refresh);
        if (names.length === 0) {
          console.log("No skills found.");
          return;
        }
        console.log("Available skills:\n");
        for (const name of names) {
          const fm = await readSkillFrontmatter(name);
          const desc = fm.description || "";
          console.log(`  ${name.padEnd(22)} ${desc}`);
        }
        console.log(`\nRun \`readwise skills install <platform>\` to install. Platforms: ${Object.keys(PLATFORMS).join(", ")}`);
      } catch (err) {
        console.error(`\x1b[31mFailed to list skills: ${(err as Error).message}\x1b[0m`);
        process.exitCode = 1;
      }
    });

  skills
    .command("install [platform]")
    .description("Install skills to an agent platform (claude, codex, opencode)")
    .option("--all", "Detect installed agents and install to all")
    .option("--refresh", "Force refresh from GitHub before installing")
    .option("-y, --yes", "Skip skill selection and install all")
    .action(async (platform?: string, opts?: { all?: boolean; refresh?: boolean; yes?: boolean }) => {
      try {
        const allNames = (await getSkillNames(!!opts?.refresh)).filter((n) => n !== "readwise-mcp");
        if (allNames.length === 0) {
          console.error("No skills found.");
          process.exitCode = 1;
          return;
        }

        let targets: { key: string; name: string; path: string }[] = [];

        if (opts?.all) {
          for (const [key, info] of Object.entries(PLATFORMS)) {
            const parentDir = dirname(info.path);
            if (existsSync(parentDir)) {
              targets.push({ key, ...info });
            }
          }
          if (targets.length === 0) {
            console.log("No supported agents detected. Supported platforms: " + Object.keys(PLATFORMS).join(", "));
            return;
          }
        } else if (platform) {
          const info = PLATFORMS[platform.toLowerCase()];
          if (!info) {
            console.error(`Unknown platform: ${platform}`);
            console.error(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`);
            process.exitCode = 1;
            return;
          }
          targets = [{ key: platform.toLowerCase(), ...info }];
        } else {
          console.error("Specify a platform or use --all.");
          console.error(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`);
          process.exitCode = 1;
          return;
        }

        // Let user pick which skills to install (unless --yes)
        let names = allNames;
        if (!opts?.yes && process.stdin.isTTY) {
          const descs = new Map<string, string>();
          for (const n of allNames) {
            const fm = await readSkillFrontmatter(n);
            if (fm.description) descs.set(n, fm.description);
          }
          const picked = await pickSkills(allNames, descs);
          if (!picked || picked.length === 0) {
            console.log("No skills selected.");
            return;
          }
          names = picked;
        }

        const cache = cacheDir();
        for (const target of targets) {
          console.log(`\nInstalling to ${target.name} (${target.path})...`);
          await mkdir(target.path, { recursive: true });

          for (const skillName of names) {
            const srcFile = join(cache, skillName, "SKILL.md");
            const destDir = join(target.path, skillName);
            await mkdir(destDir, { recursive: true });
            const content = await readFile(srcFile, "utf-8");
            await writeFile(join(destDir, "SKILL.md"), content);
            console.log(`  \u2713 ${skillName}`);
          }
        }

        console.log("\nDone!");
      } catch (err) {
        console.error(`\x1b[31mFailed to install skills: ${(err as Error).message}\x1b[0m`);
        process.exitCode = 1;
      }
    });

  skills
    .command("show <name>")
    .description("Print the raw SKILL.md for a skill")
    .option("--refresh", "Force refresh from GitHub")
    .action(async (name: string, opts: { refresh?: boolean }) => {
      try {
        await getSkillNames(!!opts.refresh);
        const skillPath = join(cacheDir(), name, "SKILL.md");
        if (!existsSync(skillPath)) {
          console.error(`Skill not found: ${name}`);
          const available = await listCachedSkills();
          if (available.length) console.error(`Available: ${available.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        const content = await readFile(skillPath, "utf-8");
        process.stdout.write(content);
      } catch (err) {
        console.error(`\x1b[31mFailed: ${(err as Error).message}\x1b[0m`);
        process.exitCode = 1;
      }
    });

  skills
    .command("update")
    .description("Force refresh skills from GitHub")
    .action(async () => {
      try {
        console.log("Fetching skills from github.com/readwiseio/readwise-skills...");
        const names = await refreshCache();
        console.log(`Updated ${names.length} skills: ${names.join(", ")}`);
      } catch (err) {
        console.error(`\x1b[31mFailed to update: ${(err as Error).message}\x1b[0m`);
        process.exitCode = 1;
      }
    });
}
