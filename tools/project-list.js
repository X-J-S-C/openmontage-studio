// OpenMontage Studio - 工具：项目列表 (T3)
import { loadIndex } from '../lib/store.js';

export const name = 'project_list';
export const description = '列出全部视频项目（Project）的索引信息：id、标题、管线、更新时间。';

export const parameters = {
  type: 'object',
  properties: {},
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
  const indexData = loadIndex(ctx.dataDir);
  return reply({ ok: true, projects: indexData.projects || [] });
}
