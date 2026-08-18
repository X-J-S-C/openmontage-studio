// OpenMontage Studio - 工具：导入文件到项目工作台
// 把本地文件复制进项目的 workDir（用户工作台）或插件数据目录，并登记为工件。
// 与页面「导入文件」按钮共用同一能力：agent 侧入口。

import { loadProject, saveProject } from '../lib/store.js';
import { sanitizeRelPath } from '../lib/path.js';
import { registerArtifact } from '../lib/artifacts.js';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

export const name = 'file_import';
export const description =
  '导入文件到项目工作台：把本地文件复制进当前项目的 workDir（或插件数据目录），并登记为工件。参数：projectId、sourcePath（本地绝对路径）、targetPath（可选，项目内相对路径，默认用文件名）、type（可选，默认 asset）、title（可选）。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    sourcePath: { type: 'string', description: '本地文件的绝对路径' },
    targetPath: { type: 'string', description: '项目内相对路径（可选，默认文件名，如 raw/xxx.mp4）' },
    type: { type: 'string', description: '工件类型（可选，默认 asset，如 asset/video/audio/script）' },
    title: { type: 'string', description: '显示名（可选）' },
  },
  required: ['projectId', 'sourcePath'],
  additionalProperties: false,
};

// 读取用户本地文件 + 写入项目目录：真实副作用，Auto 模式送审
export const sessionPermission = {
  kind: 'external_side_effect',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// 项目文件根：workDir 优先，其次插件 dataDir/projects/{id}
function projectRoot(project, dataDir) {
  return project.workDir ? project.workDir : join(dataDir, 'projects', project.id);
}

// 拒绝目录穿越：目标路径的每一段都不能是 ..
function safeJoin(root, rel) {
  const segments = String(rel || '').split(/[\\/]+/).filter(Boolean);
  if (segments.some((s) => s === '..')) return null;
  return join(root, ...segments);
}

export async function execute(input, ctx) {
  const dataDir = ctx.dataDir;
  if (!dataDir) return reply({ ok: false, error: 'ctx.dataDir 不可用' });

  const project = loadProject(dataDir, input.projectId);
  if (!project) return reply({ ok: false, error: '项目不存在: ' + input.projectId });

  const source = input.sourcePath;
  if (!existsSync(source)) return reply({ ok: false, error: '源文件不存在: ' + source });

  const root = projectRoot(project, dataDir);
  const rel = input.targetPath || basename(source);
  // 安全线：目标相对路径再经统一校验（拒绝 .. / 绝对路径 / 空段）
  if (!sanitizeRelPath(rel)) {
    return reply({ ok: false, error: '目标路径非法（含 .. 目录穿越或绝对路径）: ' + rel });
  }
  const target = safeJoin(root, rel);
  if (!target) return reply({ ok: false, error: '目标路径非法（含 .. 目录穿越）' });
  if (target === source) return reply({ ok: false, error: '源与目标相同，无需导入' });

  try {
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(source, target);
  } catch (e) {
    return reply({ ok: false, error: '复制失败: ' + (e && e.message ? e.message : String(e)) });
  }

  // 登记工件到当前阶段（共享登记逻辑：同 stage 同 path → version+1）
  const stage = project.stages.find((s) => s.stageId === project.currentStageId) || project.stages[0];
  if (!stage) {
    return reply({ ok: false, error: '项目暂无阶段可登记，无法导入' });
  }
  const result = registerArtifact(project, stage.stageId, rel, input.type || 'asset', input.title || basename(rel));
  if (!result.ok) {
    return reply(result);
  }
  saveProject(dataDir, project);

  return reply({ ok: true, artifact: result.artifact, projectRoot: root, copiedTo: target });
}