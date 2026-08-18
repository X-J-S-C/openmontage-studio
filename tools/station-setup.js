// OpenMontage Studio - 工具：一键准备工位 Agent（第三层）
// 复用已存在的工位 agent；缺失时自动创建为插件私有 agent。
import { setupStations } from '../lib/stations.js';

export const name = 'station_setup';
export const description =
  '一键准备三个工位 Agent（编/导/制）：已存在的直接复用，缺失的自动创建为插件私有 Agent。新环境首次安装后建议先调用本工具。返回每个工位的状态与当前配置。';

export const parameters = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

// 创建 agent 属于宿主配置变更（真实副作用），Auto 模式下会送 reviewer 确认
export const sessionPermission = {
  kind: 'external_side_effect',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function execute(input, ctx) {
  const result = await setupStations(ctx);
  return reply(result);
}