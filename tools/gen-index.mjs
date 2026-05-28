#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const opts = {
    out: join(REPO_ROOT, "index.json"),
    generatedAt: null,
    stdout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--generated-at") opts.generatedAt = argv[++i];
    else if (a === "--stdout") opts.stdout = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function decodePath(skillPath) {
  const segs = skillPath.split("/");
  const domainDir = segs[1];
  if (domainDir === "_meta") {
    return { domain: "meta", oem: null, action: segs.slice(2).join("-"), kind: "meta" };
  }
  if (segs[2] === "_generic") {
    return { domain: domainDir, oem: null, action: segs.slice(3).join("-"), kind: "generic" };
  }
  return { domain: domainDir, oem: segs[2], action: segs.slice(3).join("-"), kind: "vendor" };
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function generateIndex(opts = {}) {
  const catalog = JSON.parse(readFileSync(join(REPO_ROOT, "catalog.json"), "utf8"));
  const skills = catalog.skills.map((skill) => {
    const decoded = decodePath(skill.path);
    return {
      name: skill.name,
      topic: titleFromSlug(decoded.action),
      domain: decoded.domain,
      oem: decoded.oem,
      action: decoded.action,
      kind: decoded.kind,
      path: skill.path,
      description: skill.description,
      tags: skill.tags,
      files: skill.files,
      sha256: skill.sha256,
      ...(skill.compatibility ? { compatibility: skill.compatibility } : {}),
      ...(skill.version ? { version: skill.version } : {}),
    };
  });
  const domains = {};
  for (const skill of skills) {
    domains[skill.domain] ||= { count: 0, oems: {} };
    domains[skill.domain].count++;
    const key = skill.oem || "_generic";
    domains[skill.domain].oems[key] = (domains[skill.domain].oems[key] || 0) + 1;
  }
  return {
    schemaVersion: 1,
    repo: catalog.repo,
    channel: catalog.channel,
    ref: catalog.ref,
    commit: catalog.commit,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    totalSkills: skills.length,
    domains,
    skills,
  };
}

export function serialize(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseArgs(process.argv.slice(2));
  const text = serialize(generateIndex({ generatedAt: opts.generatedAt }));
  if (opts.stdout) process.stdout.write(text);
  else {
    writeFileSync(opts.out, text);
    process.stderr.write(`gen-index: wrote ${opts.out}\n`);
  }
}
