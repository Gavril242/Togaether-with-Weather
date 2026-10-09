import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lint } from "markdownlint/promise";

const excludedDirectories = new Set([
  ".git",
  ".local",
  ".next",
  "node_modules",
  "coverage",
  "data",
  "dist",
  "playwright-report",
  "test-results",
]);

async function markdownFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
      files.push(...await markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files.sort();
}

const files = await markdownFiles(".");
const config = JSON.parse(await readFile(".markdownlint.json", "utf8"));
const results = await lint({ files, config });
let errorCount = 0;

for (const [file, errors] of Object.entries(results)) {
  for (const error of errors) {
    console.error(`${file}:${error.lineNumber} ${error.ruleNames[0]} ${error.ruleDescription}${error.errorDetail ? ` (${error.errorDetail})` : ""}`);
    errorCount += 1;
  }
}

console.log(`Checked ${files.length} Markdown files; ${errorCount} issues.`);
process.exitCode = errorCount > 0 ? 1 : 0;
