// OpenMontage Studio - 项目数据存储 (T3)
// 职责：Project 元数据 JSON 的读写，全部落在插件 dataDir 下
// 结构：dataDir/index.json（项目索引）+ dataDir/projects/{id}.json（项目详情）
// 注意：只读写插件自有 dataDir，不碰用户资源（符合插件边界）

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function projectsRoot(dataDir) {
  return join(dataDir, 'projects');
}

export function indexFile(dataDir) {
  return join(dataDir, 'index.json');
}

export function projectFile(dataDir, projectId) {
  return join(projectsRoot(dataDir), projectId + '.json');
}

// 默认阶段列表（T5 起改为从 pipeline_defs/*.yaml 动态读取）
// 此处保持与 OpenMontage 通用流程一致的最小集合，含 edit
// owner 此处为角色（director/script/maker），创建项目时由 project_create
// 依据用户配置映射为具体的 agent id（lib/config.js）
export const DEFAULT_STAGES = [
  { stageId: 'brief', name: '需求', owner: 'director' },
  { stageId: 'script', name: '剧本', owner: 'script' },
  { stageId: 'storyboard', name: '分镜', owner: 'script' },
  { stageId: 'assets', name: '素材', owner: 'maker' },
  { stageId: 'edit', name: '剪辑', owner: 'maker' },
  { stageId: 'compose', name: '合成', owner: 'maker' },
  { stageId: 'review', name: '审片', owner: 'director' },
  { stageId: 'deliver', name: '交付', owner: 'maker' },
];

export function loadIndex(dataDir) {
  try {
    return JSON.parse(readFileSync(indexFile(dataDir), 'utf-8'));
  } catch {
    return { version: 1, projects: [] };
  }
}

export function saveIndex(dataDir, indexData) {
  mkdirSync(projectsRoot(dataDir), { recursive: true });
  writeFileSync(indexFile(dataDir), JSON.stringify(indexData, null, 2), 'utf-8');
}

export function loadProject(dataDir, projectId) {
  try {
    return JSON.parse(readFileSync(projectFile(dataDir, projectId), 'utf-8'));
  } catch {
    return null;
  }
}

export function saveProject(dataDir, project) {
  mkdirSync(projectsRoot(dataDir), { recursive: true });
  writeFileSync(projectFile(dataDir, project.id), JSON.stringify(project, null, 2), 'utf-8');
}

export function deleteProject(dataDir, projectId) {
  const file = projectFile(dataDir, projectId);
  if (existsSync(file)) {
    // 仅删除元数据；工作区工件文件由用户/制的 agent 管理
    try {
      writeFileSync(file, '', 'utf-8'); // 置空占位，避免误删后无法诊断
    } catch {
      /* ignore */
    }
  }
}
