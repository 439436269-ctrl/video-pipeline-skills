#!/usr/bin/env node
/**
 * 把这 19 个 skill 装进宿主。
 *
 *   node install.mjs --list                          # 列出将安装哪些 skill
 *   node install.mjs --host claude                   # 装到 ~/.claude/skills（本机实测路径）
 *   node install.mjs --host claude --dry-run         # 只打印将做什么
 *   node install.mjs --host codex --dest <目录>       # Codex：目录请按官方文档确认后传入
 *   node install.mjs --dest <任意目录> --copy         # 装到任意目录，复制而非链接
 *   node install.mjs --host claude --force           # 覆盖同名且内容不同的已有 skill
 *
 * 默认用**链接**（Windows junction / Unix symlink），这样以后 git pull 就同步了；
 * 加 --copy 则复制一份快照。
 *
 * 关于 Codex 的目录：本项目核实到 Codex 有 skills 机制、按 user/repo/system/admin
 * 四类 scope 加载 SKILL.md（来自 openai/codex 源码的 SkillScope/SkillMetadata），
 * 但**没有核实到 user scope 的具体路径**。所以本脚本把 ~/.codex/skills 标注为推断值，
 * 并打印官方文档地址让你确认；也可以用 --dest 指到你自己确认过的目录。
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件在仓根，所以仓根就是它自己的目录（tools/ 下的脚本才是 '..'）。
const ROOT = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(ROOT, 'skills');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const HOSTS = {
  claude: { dir: join(homedir(), '.claude', 'skills'), verified: true, note: '本机实测存在的用户级 skill 目录' },
  codex: { dir: join(homedir(), '.codex', 'skills'), verified: false, note: '推断值（未在本机核实），官方文档：https://developers.openai.com/codex/skills' },
};

const names = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SKILLS, d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

if (flag('list')) {
  console.log(`本仓 ${names.length} 个 skill：`);
  for (const name of names) {
    const attrs = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8').split(/\r?\n/).slice(0, 6).join(' ');
    console.log(`  ${name}`);
    void attrs;
  }
  process.exit(0);
}

const host = arg('host');
const hostSpec = host ? HOSTS[host] : undefined;
if (host && !hostSpec) {
  console.error(`未知宿主 ${host}；可用：${Object.keys(HOSTS).join(', ')}，或用 --dest 直接给目录`);
  process.exit(2);
}

const dest = resolve(arg('dest', hostSpec?.dir ?? ''));
if (!dest) {
  console.error('需要 --host claude|codex 或 --dest <目录>');
  process.exit(2);
}

const copy = flag('copy');
const force = flag('force');
const dryRun = flag('dry-run');

console.log(`源：${SKILLS}（${names.length} 个 skill）`);
console.log(`目标：${dest}`);
console.log(`方式：${copy ? '复制' : '链接（Windows junction / symlink）'}${dryRun ? '（dry-run，不写盘）' : ''}`);
if (hostSpec && !hostSpec.verified) {
  console.log(`⚠️  ${host} 的目标目录是${hostSpec.note}`);
}
if (hostSpec) console.log(`    ${hostSpec.note}`);

if (!dryRun) mkdirSync(dest, { recursive: true });

let installed = 0;
let skipped = 0;
for (const name of names) {
  const from = join(SKILLS, name);
  const to = join(dest, name);

  if (existsSync(to) || (() => { try { lstatSync(to); return true; } catch { return false; } })()) {
    if (!force) {
      console.log(`  = ${name}：目标已存在，跳过（要覆盖加 --force）`);
      skipped += 1;
      continue;
    }
    console.log(`  ~ ${name}：覆盖已存在的目标`);
    if (!dryRun) rmSync(to, { recursive: true, force: true });
  }

  if (dryRun) {
    console.log(`  + ${name} → ${copy ? '复制' : '链接'}`);
    installed += 1;
    continue;
  }

  if (copy) {
    cpSync(from, to, { recursive: true });
  } else {
    try {
      symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      console.error(`  ❌ ${name} 链接失败（${error.message}）—— 改用 --copy 再试`);
      process.exitCode = 1;
      continue;
    }
  }
  installed += 1;
  console.log(`  + ${name}`);
}

console.log(`\n完成：装 ${installed} 个，跳过 ${skipped} 个。`);
if (installed && !dryRun) {
  console.log('重启宿主（或新开会话）后生效。');
  if (!copy) console.log('链接方式下，以后 git pull 更新本仓即同步；卸载就删掉目标目录里的这些 skill 目录。');
  else console.log('复制方式下，更新本仓后需要重新跑一次本脚本。');
}
if (statSync(SKILLS).isDirectory() && names.length !== 19) {
  console.log(`\n⚠️  期望 19 个 skill，实际找到 ${names.length} 个 —— 先跑 node tools/sync-skills.mjs --write。`);
}
