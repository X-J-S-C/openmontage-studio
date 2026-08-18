// OpenMontage Studio - 工作台自动登记扫描
// 职责：扫描项目根目录，把工作台内新出现的文件自动登记为工件。
// 触发路径：/api/artifacts（前端轮询），带节流，避免频繁全扫。
// 目的：工位 agent 或用户写入的成品/素材自动出现在工件库并可预览，无需手动 artifact_register。

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject, saveProject } from './store.js';
import { inferType } from './type-map.js';
import { sanitizeRelPath } from './path.js';
import { registerArtifact } from './artifacts.js';

const MAX_DEPTH = 8;
const SKIP_NAMES = new Set(['.git', '.svn', 'node_modules', '.obsidian', '.trash', '__pycache__', 'thumbs.db', '.ds_store']);

// 工件类型映射（TYPE_BY_EXT/inferType）见 ./type-map.js —— 服务端单一来源

function walk(dir, base, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const en of entries) {
    const name = en.name;
    if (name === '.gitkeep' || name === '.gitignore') continue;
    if (name.startsWith('.')) continue; // 隐藏文件/目录
    if (SKIP_NAMES.has(name.toLowerCase())) continue; // 大小写不敏感的忽略名单
    const rel = base ? base + '/' + name : name;
    if (en.isDirectory()) {
      walk(join(dir, name), rel, depth + 1, out);
    } else if (en.isFile()) {
      out.push(rel);
    }
  }
}

// 递归列出根目录下的全部相对文件路径
export function scanFiles(root) {
  const out = [];
  try {
    walk(root, '', 0, out);
  } catch {
    return out;
  }
  // 防御：仅保留能通过相对路径校验的登记路径（源码 walk 不产生 ..，此处兜底）
  return out.filter((p) => sanitizeRelPath(p) !== null);
}

// 与已登记工件对比，增量登记新文件；返回新增工件列表
export function autoRegister(project, dataDir) {
  if (!project) return [];
  const root = project.workDir ? project.workDir : join(dataDir, 'projects', project.id);

  const known = new Set();
  for (const st of project.stages || []) {
    for (const a of st.artifacts || []) known.add(a.path);
  }

  const stage = (project.stages || []).find((s) => s.stageId === project.currentStageId) || (project.stages || [])[0];
  if (!stage) return [];
  if (!Array.isArray(stage.artifacts)) stage.artifacts = [];

  const added = [];
  for (const rel of scanFiles(root)) {
    if (known.has(rel)) continue;
    // 共享登记逻辑；自动登记标记 auto 由 scan 补写（registerArtifact 不写此字段）
    const res = registerArtifact(project, stage.stageId, rel, inferType(rel));
    if (!res.ok || !res.artifact) continue;
    res.artifact.auto = true;
    known.add(rel);
    added.push(res.artifact);
  }

  if (added.length > 0) {
    project.updatedAt = new Date().toISOString();
    saveProject(dataDir, project);
  }
  return added;
}

// 兼容工具层：loadProject + autoRegister 打包调用
export function ensureAutoRegistered(dataDir, projectId) {
  const project = loadProject(dataDir, projectId);
  if (!project) return { ok: false, error: '项目不存在' };
  const added = autoRegister(project, dataDir);
  return { ok: true, added };
}