// OpenMontage Studio - 工具：登记工件 (T8)
// 职责：把工位产出的文件登记进项目工件库（元数据），文件实体已由工位 agent 写入项目目录
// version 规则：同 stage 同 path 已存在则 +1（重写场景），否则 1

import { loadProject, saveProject } from '../lib/store.js';
import { sanitizeRelPath } from '../lib/path.js';
import { registerArtifact } from '../lib/artifacts.js';

export const name = 'artifact_register';
export const description =
  '登记工件：把工位产出的文件登记进项目工件库。参数：projectId、stageId、type（如 script/storyboard/asset/video/subtitle/report）、path（相对项目目录，如 scripts/v2.md）、title（可选显示名）。文件实体需已存在于项目目录。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    stageId: { type: 'string', description: '所属阶段 id' },
    type: { type: 'string', description: '工件类型' },
    path: { type: 'string', description: '相对项目目录的文件路径' },
    title: { type: 'string', description: '显示名，可选' },
  },
  required: ['projectId', 'stageId', 'type', 'path'],
  additionalProperties: false,
};

export const sessionPermission = {
  kind: 'plugin_output',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function execute(input, ctx) {
  const dataDir = ctx.dataDir;
  if (!dataDir) {
    return reply({ ok: false, error: 'ctx.dataDir 不可用' });
  }
  const project = loadProject(dataDir, input.projectId);
  if (!project) {
    return reply({ ok: false, error: '项目不存在: ' + input.projectId });
  }
  // 安全线：校验登记路径，拒绝目录穿越/绝对路径/空段
  const safePath = sanitizeRelPath(input.path);
  if (!safePath) {
    return reply({ ok: false, error: '工件路径非法（拒绝目录穿越/绝对路径/空段）: ' + input.path });
  }

  // 共享登记逻辑：同 stage 同 path → version+1
  const result = registerArtifact(project, input.stageId, safePath, input.type, input.title);
  if (!result.ok) {
    return reply(result);
  }
  saveProject(dataDir, project);

  return reply({ ok: true, artifact: result.artifact });
}
