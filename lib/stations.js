// OpenMontage Studio - 工位 Agent 准备（第三层：一键创建）
// 职责：确保三个工位 agent（编/导/制）就绪。
//   - 已存在：直接复用（兼容用户自建或默认 bianju/daoyan/zhizuo 环境）
//   - 缺失：通过 agent:create 创建 plugin_private 的私有 agent（不进主列表，不污染用户界面）
// 技术依据：官方插件开发指南「内置 Session / Agent 能力」表 + agent:create 能力
//   (hub/event-bus-capabilities.ts: agent:create, permission: agent.write)
//   SDK 示例：createAgent(ctx, { name, visibility: "plugin_private", memoryPolicy }) → agent.agent.id

import { getConfig, agentList } from './config.js';

const ROLE_NAMES = { script: '编剧', director: '导演', maker: '制作' };

export async function setupStations(pluginCtx) {
  const bus = pluginCtx && pluginCtx.bus;
  if (!bus || typeof bus.request !== 'function') {
    return { ok: false, error: 'EventBus 不可用，无法创建 Agent' };
  }

  const cfg = await getConfig(pluginCtx);
  const results = [];

  for (const station of agentList(cfg.agents)) {
    const { id, role, name } = station;
    try {
      if (await agentExists(bus, id)) {
        results.push({ role, shortName: name, agentId: id, status: 'ready', note: '已存在，直接复用' });
        continue;
      }
      const created = await bus.request('agent:create', {
        id,
        name: 'OpenMontage·' + (ROLE_NAMES[role] || role),
        visibility: 'plugin_private',
        ownerPluginId: pluginCtx.pluginId || 'openmontage-studio',
        memoryPolicy: { enabled: true },
      });
      const agentId = created && created.agent && created.agent.id;
      results.push({
        role,
        shortName: name,
        agentId: agentId || id,
        status: 'created',
        note: '已创建（插件私有，不出现在主 Agent 列表）',
      });
    } catch (e) {
      results.push({
        role,
        shortName: name,
        agentId: id,
        status: 'error',
        error: e && e.message ? e.message : String(e),
      });
    }
  }

  const failed = results.filter((r) => r.status === 'error');
  return {
    ok: failed.length === 0,
    results,
    error: failed.length ? '部分工位 Agent 准备失败，请查看明细' : '',
  };
}

async function agentExists(bus, agentId) {
  // 命中前提：agent:profile 走内存态 getAgent（懒加载），未激活的 agent 会查不到；
  // agent:list 走目录扫描（磁盘级，可靠），先以列表为准，profile 留作兜底与交叉验证。
  try {
    const listed = await bus.request('agent:list', { includePluginPrivate: true });
    const items = (listed && listed.agents) || [];
    if (items.some((a) => a && a.id === agentId)) return true;
  } catch { /* 列表失败则继续尝试 profile */ }
  try {
    const got = await bus.request('agent:profile', { agentId });
    return !!(got && (got.profile || got.agent));
  } catch {
    return false;
  }
}