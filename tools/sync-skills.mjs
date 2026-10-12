#!/usr/bin/env node
/**
 * 把 DSH 插件仓库里那 19 个（已脱敏的）skill 同步成本仓库的宿主中立版本。
 *
 *   node tools/sync-skills.mjs --from <dsh 插件目录> --check    # 只比对，有漂移则非零退出
 *   node tools/sync-skills.mjs --from <dsh 插件目录> --write    # 写盘
 *
 * 单一真源：skill 正文只在 DSH 插件仓里维护（那里有可复现导入器与隐私门）。
 * 本仓是它的**下游分发**，只做三件宿主差异处理：
 *
 *   1. `{{TOKEN}}` → 可读默认值。DSH 会在加载时替换这些占位符，其他宿主没有这个机制，
 *      所以这里落成静态文本；取值直接 import DSH 仓的 lib/placeholders.js，不另抄一份表。
 *   2. 在入口 skill 的 frontmatter 之后插入一段宿主说明。用结构性插入而不是逐字替换散文：
 *      逐字替换会随正文改动而静默失效（这个项目里已经栽过几次）。
 *   3. 行尾归一为 LF（两个仓都这么要求，避免 npm/tarball 出现假差异）。
 *
 * 二进制文件原样复制；其余文件一律当文本处理。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TARGET = join(ROOT, 'skills');

const mode = process.argv.includes('--write') ? 'write' : 'check';
const argFrom = (() => {
  const i = process.argv.indexOf('--from');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const SOURCE = resolve(argFrom ?? join(ROOT, '..', '.dsh-plugins', 'src', 'dsh-video-pipeline'));

/** 入口 skill：插入宿主说明的那一个。 */
const ENTRY_SKILL = 'video-pipeline';
const HOST_NOTE = [
  '> **本仓是宿主中立版本**（Claude Code / Codex 等支持 `SKILL.md` 的宿主）。安装方式见本仓 `README.md`。',
  '> 下面正文与 DSH 插件仓同源；正文里凡出现「DSH」，指的是这套 skill 的上游宿主。',
  '> 其中「插件配置 `placeholders`」「加载时自动替换」也是 DSH 的机制——在本仓里占位符已经直接写成可读值',
  '> （例如 `%USERPROFILE%`、`<飞书 base app_token>`），按需改成你自己的即可。',
].join('\n');

const TEXT_EXT = new Set(['.md', '.markdown', '.json', '.js', '.mjs', '.py', '.txt', '.yml', '.yaml', '.sh', '.example', '.ass', '.srt', '.svg', '.cfg']);
const TEXT_NAMES = new Set(['LICENSE', 'LICENCE', 'NOTICE', 'README', 'CHANGELOG', '.gitkeep']);
const isText = (p) => {
  const name = p.split('/').pop();
  const dot = name.lastIndexOf('.');
  return TEXT_EXT.has(dot > 0 ? name.slice(dot).toLowerCase() : '') || TEXT_NAMES.has(name);
};

function walk(root, current = root, out = []) {
  for (const dirent of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, dirent.name);
    if (dirent.isDirectory()) walk(root, full, out);
    else if (dirent.isFile()) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** 读取 DSH 仓的占位符默认值表（同一份真源，不复制）。 */
async function loadPlaceholderDefaults() {
  const file = join(SOURCE, 'lib', 'placeholders.js');
  if (!existsSync(file)) {
    console.error(`找不到 ${file}；用 --from 指定 DSH 插件目录`);
    process.exit(2);
  }
  const mod = await import(pathToFileURL(file).href);
  return mod.PLACEHOLDER_DEFAULTS;
}

/** 在 frontmatter 之后插入宿主说明（幂等）。 */
function withHostNote(text) {
  if (text.includes('本仓是宿主中立版本')) return text;
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return text;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return text;
  return [...lines.slice(0, end + 1), '', HOST_NOTE, ...lines.slice(end + 1)].join('\n');
}

const defaults = await loadPlaceholderDefaults();
const tokenRe = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/** 把占位符落成静态文本，并返回用过哪些 token。 */
function resolvePlaceholders(text) {
  const used = new Set();
  const out = text.replace(tokenRe, (match, token) => {
    if (!(token in defaults)) return match;   // 未知 token 原样保留，别静默吃掉
    used.add(token);
    return String(defaults[token]);
  });
  return { text: out, used };
}

const sourceSkills = join(SOURCE, 'skills');
if (!existsSync(sourceSkills)) {
  console.error(`找不到 ${sourceSkills}`);
  process.exit(2);
}

const files = walk(sourceSkills).sort();
const plan = [];
const usedTokens = new Set();
const rewrites = [];

for (const rel of files) {
  const from = join(sourceSkills, rel);
  if (!isText(rel)) {
    plan.push({ rel, kind: 'binary', bytes: readFileSync(from) });
    continue;
  }
  let text = readFileSync(from, 'utf8').replace(/\r\n?/g, '\n');
  const resolved = resolvePlaceholders(text);
  text = resolved.text;
  for (const t of resolved.used) usedTokens.add(t);
  if (rel === `${ENTRY_SKILL}/SKILL.md`) {
    const before = text;
    text = withHostNote(text);
    if (text !== before) rewrites.push(`${rel} ← 插入宿主说明`);
  }
  plan.push({ rel, kind: 'text', text });
}

// 与现有目录比对漂移
const drift = [];
if (existsSync(TARGET)) {
  for (const item of plan) {
    const target = join(TARGET, ...item.rel.split('/'));
    if (!existsSync(target)) { drift.push(`缺 ${item.rel}`); continue; }
    const has = item.kind === 'binary' ? readFileSync(target) : readFileSync(target, 'utf8');
    const want = item.kind === 'binary' ? item.bytes : item.text;
    const same = item.kind === 'binary' ? Buffer.compare(has, want) === 0 : has === want;
    if (!same) drift.push(`不同 ${item.rel}`);
  }
  const onDisk = new Set(walk(TARGET));
  for (const rel of onDisk) {
    if (!plan.some((p) => p.rel === rel)) drift.push(`多出 ${rel}`);
  }
} else {
  drift.push('skills/ 目录不存在');
}

console.log(`源：${sourceSkills}`);
console.log(`目标：${TARGET}`);
console.log(`文件：${plan.length} 个（文本 ${plan.filter((p) => p.kind === 'text').length} / 二进制 ${plan.filter((p) => p.kind === 'binary').length}）`);
console.log(`落成静态值的占位符：${[...usedTokens].sort().join(', ') || '（无）'}`);
for (const r of rewrites) console.log(`改写：${r}`);

if (mode === 'check') {
  if (drift.length) {
    console.log(`\n与源不同步（${drift.length} 处）：`);
    for (const d of drift.slice(0, 20)) console.log(`  ${d}`);
    if (drift.length > 20) console.log(`  …另有 ${drift.length - 20} 处`);
    console.log('\n跑 node tools/sync-skills.mjs --write 同步。');
    process.exit(1);
  }
  console.log('\n与源一致 ✅');
  process.exit(0);
}

rmSync(TARGET, { recursive: true, force: true });
for (const item of plan) {
  const target = join(TARGET, ...item.rel.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, item.kind === 'binary' ? item.bytes : item.text);
}
console.log(`\n写入 ${plan.length} 个文件 → ${TARGET}`);
