#!/usr/bin/env node
/**
 * 本仓自检（无第三方依赖）。
 *
 *   node tools/verify-repo.mjs            # 清单 + skills 结构
 *   node tools/verify-repo.mjs --claude   # additionally 调 claude plugin validate
 *
 * 为什么不能只靠 `claude plugin validate`：实测（2026-10-12）它在仓根**只严格校验
 * marketplace 清单**，plugin.json 仅用于版本交叉核对——故意把 plugin.json 写成缺
 * name 的坏 JSON，它只给 warning、**exit 仍是 0**。所以这里做确定性断言，并把
 * claude 的 warning 也算失败。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WITH_CLAUDE = process.argv.includes('--claude');
const problems = [];
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); problems.push(m); };
const info = (m) => console.log(`  ·  ${m}`);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 严格读一个 JSON 文件。 */
function readJson(rel) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) { bad(`缺少 ${rel}`); return undefined; }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    bad(`${rel} 不是合法 JSON：${error.message}`);
    return undefined;
  }
}

/** 极简 frontmatter 读取（够用即可：name/description，含块标量）。 */
function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const attrs = {};
  let key = null;
  let block = null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break;
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (m) {
      key = m[1];
      const rest = m[2].trim();
      if (rest === '|' || rest === '>') { block = []; attrs[key] = ''; continue; }
      block = null;
      attrs[key] = rest.replace(/^(['"])(.*)\1$/, '$2');
      continue;
    }
    if (block && lines[i].trim()) block.push(lines[i].trim());
    if (block) attrs[key] = block.join(' ');
  }
  return attrs;
}

console.log('\n一、Claude Code 插件清单');
const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  if (KEBAB.test(plugin.name ?? '')) ok(`plugin.json name：${plugin.name}`);
  else bad(`plugin.json 的 name 必须是 kebab-case，实际 ${JSON.stringify(plugin.name)}`);
  if (plugin.description && plugin.description.length > 20) ok(`plugin.json description（${plugin.description.length} 字符）`);
  else bad('plugin.json 缺 description 或过短');
  if (!plugin.version) info('plugin.json 没有 version（可选）');
}

console.log('\n二、Claude Code 市场清单');
const market = readJson('.claude-plugin/marketplace.json');
if (market) {
  if (market.name) ok(`marketplace name：${market.name}`);
  else bad('marketplace.json 缺 name');
  if (market.owner?.name) ok(`owner：${market.owner.name}`);
  else bad('marketplace.json 缺 owner.name');
  const list = Array.isArray(market.plugins) ? market.plugins : [];
  if (list.length) ok(`plugins 条目：${list.length}`);
  else bad('marketplace.json 的 plugins 为空');
  for (const entry of list) {
    if (!entry.name || !entry.description || !entry.source) {
      bad(`插件条目缺字段（需要 name/description/source）：${JSON.stringify(entry).slice(0, 80)}`);
      continue;
    }
    // source 必须真的指到一个含 .claude-plugin/plugin.json 的目录
    const rel = typeof entry.source === 'string' ? entry.source : entry.source?.path;
    if (!rel) { info(`插件 ${entry.name} 的 source 是远程形式，跳过本地解析`); continue; }
    const dir = resolve(ROOT, rel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { bad(`插件 ${entry.name} 的 source 指向不存在的目录：${rel}`); continue; }
    if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) { bad(`插件 ${entry.name} 的 source 目录里没有 .claude-plugin/plugin.json`); continue; }
    ok(`插件 ${entry.name} → ${rel}（含 .claude-plugin/plugin.json）`);
  }
  if (plugin?.version && list[0]?.version && plugin.version !== list[0].version) {
    bad(`plugin.json 版本 ${plugin.version} 与市场条目版本 ${list[0].version} 不一致`);
  }
}

console.log('\n三、skills 结构');
const skillsDir = join(ROOT, 'skills');
if (!existsSync(skillsDir)) {
  bad('缺少 skills/ 目录');
} else {
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  ok(`skill 目录：${dirs.length} 个`);
  let withToken = 0;
  for (const name of dirs) {
    const file = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) { bad(`${name}/ 里没有 SKILL.md`); continue; }
    const text = readFileSync(file, 'utf8');
    const attrs = frontmatter(text);
    if (attrs.name !== name) bad(`${name}/SKILL.md 的 frontmatter name 是 ${JSON.stringify(attrs.name)}，与目录名不符`);
    if (!attrs.description || attrs.description.length < 20) bad(`${name}/SKILL.md 的 description 缺失或过短`);
    if (/\{\{[A-Z0-9_]+\}\}/.test(text)) { withToken += 1; bad(`${name}/SKILL.md 残留未落值的占位符`); }
    if (/\r\n/.test(text)) bad(`${name}/SKILL.md 是 CRLF 行尾`);
  }
  if (!withToken) ok('所有 SKILL.md 都无未落值的占位符，且为 LF 行尾');
}

console.log('\n四、claude plugin validate');
if (!WITH_CLAUDE) {
  info('未加 --claude，跳过（本机装了 Claude Code 时可加）');
} else {
  let output = '';
  let failed = false;
  try {
    output = execFileSync('claude', ['plugin', 'validate', ROOT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (error) {
    failed = true;
    output = `${error.stdout || ''}${error.stderr || ''}${error.message}`;
  }
  // 关键：坏掉的 plugin.json 只产生 warning 且 exit 0，所以 warning 也要当失败
  if (/warning/i.test(output) && !/0 warning/i.test(output)) {
    bad('claude plugin validate 报了 warning（坏清单可能只是 warning，不能只看 exit code）');
    const line = output.split(/\r?\n/).find((l) => /warning/i.test(l));
    if (line) info(line.trim());
  } else if (failed) {
    bad(`claude plugin validate 失败：${output.trim().split('\n').slice(-3).join(' / ')}`);
  } else {
    ok('claude plugin validate 通过且无 warning');
  }
}

console.log(`\n${problems.length ? `自检未通过：${problems.length} 个问题` : '自检通过'}`);
process.exit(problems.length ? 1 : 0);
