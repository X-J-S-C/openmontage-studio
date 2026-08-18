// OpenMontage Studio - 工具：删除项目 (T3)
import { loadIndex, saveIndex, projectFile } from '../lib/store.js';
import { existsSync, writeFileSync } from 'node:fs';

export const name = 'project_delete';
export const description =
  '删除视频项目元数据（从索引移除并清空项目文件）。注意：工作区内的工件文件不受影响。参数：projectId。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
  },
  required: ['projectId'],
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

  const indexData = loadIndex(dataDir);
  const before = (indexData.projects || []).length;
  indexData.projects = (indexData.projects || []).filter((p) => p.id !== input.projectId);
  if (indexData.projects.length === before) {
    return reply({ ok: false, error: '项目不存在: ' + input.projectId });
  }
  saveIndex(dataDir, indexData);

  const file = projectFile(dataDir, input.projectId);
  if (existsSync(file)) {
    try {
      writeFileSync(file, '', 'utf-8');
    } catch {
      /* ignore */
    }
  }

  return reply({ ok: true, deleted: input.projectId });
}
