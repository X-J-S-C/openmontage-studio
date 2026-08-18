// OpenMontage Studio - 工具：项目详情 (T3)
import { loadProject } from '../lib/store.js';

export const name = 'project_get';
export const description = '读取单个视频项目的完整详情：阶段状态、工件清单、验收记录。参数：projectId。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
  },
  required: ['projectId'],
  additionalProperties: false,
};

export const sessionPermission = {
  kind: 'read_only',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function execute(input, ctx) {
  if (!ctx.dataDir) {
    return reply({ ok: false, error: 'ctx.dataDir 不可用' });
  }
  const project = loadProject(ctx.dataDir, input.projectId);
  if (!project) {
    return reply({ ok: false, error: '项目不存在: ' + input.projectId });
  }
  return reply({ ok: true, project });
}
