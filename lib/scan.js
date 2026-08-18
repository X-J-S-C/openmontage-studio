// OpenMontage Studio - 工作台自动登记扫描
// 职责：扫描项目根目录，把工作台内新出现的文件自动登记为工件。
// 触发路径：/api/artifacts（前端轮询），带节流，避免频繁全扫。
// 目的：工位 agent 或用户写入的成品/素材自动出现在工件库并可预览，无需手动 artifact_register。

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadProject, saveProject } from './store.js';

const MAX_DEPTH = 8;
const SKIP_NAMES = new Set(['.git', '.svn', 'node_modules', '.obsidian', '.trash', '__pycache__', 'thumbs.db', '.ds_store']);

const TYPE_BY_EXT = {
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'm4v', 'ts'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'],
  audio: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus'],
  script: ['md', 'txt', 'docx', 'doc', 'pdf', 'pptx'],
  subtitle: ['srt', 'ass', 'vtt'],
  data: ['json', 'yaml', 'yml', 'csv', 'xml'],
};

export function inferType(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const [t, exts] of Object.entries(TYPE_BY_EXT)) {
    if (exts.includes(ext)) return t;
  }
  return 'asset';
}

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
  return out;
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
    const artifact = {
      id: 'a_' + randomUUID().slice(0, 8),
      type: inferType(rel),
      path: rel,
      version: 1,
      stageId: stage.stageId,
      title: rel.split('/').pop(),
      createdAt: new Date().toISOString(),
      auto: true,
    };
    stage.artifacts.push(artifact);
    known.add(rel);
    added.push(artifact);
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