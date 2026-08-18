// OpenMontage Studio - 配置读取（发布版）
// 职责：统一读取用户配置（仓库路径 + 三个工位 agent id），带默认值兜底。
// 角色是固定的（script/director/maker），agent id 由用户在插件设置里配置，
// 默认值保持与开发环境一致，未配置时行为不变。

export const DEFAULT_AGENTS = {
  script: 'bianju',
  director: 'daoyan',
  maker: 'zhizuo',
};

export async function getConfig(ctx) {
  const cfg = ctx && ctx.config;
  const get = async (key, fallback) =>
    cfg && typeof cfg.get === 'function' ? (await cfg.get(key)) || fallback : fallback;

  const repoPath = (await get('openmontageRepoPath', '') || '').trim();
  const deskDeliverDir = (await get('deskDeliverDir', '') || '').trim();
  const agents = {
    script: (await get('agentScript', DEFAULT_AGENTS.script) || DEFAULT_AGENTS.script).trim(),
    director: (await get('agentDirector', DEFAULT_AGENTS.director) || DEFAULT_AGENTS.director).trim(),
    maker: (await get('agentMaker', DEFAULT_AGENTS.maker) || DEFAULT_AGENTS.maker).trim(),
  };
  return { repoPath, deskDeliverDir, agents };
}

// 角色 → agent id（role: script | director | maker）
export function roleToAgent(agents, role) {
  return (agents && agents[role]) || agents.director || DEFAULT_AGENTS.director;
}

// 三个工位的展示列表（顺序即前端 tab 顺序）
export function agentList(agents) {
  const a = agents || DEFAULT_AGENTS;
  return [
    { id: a.script, role: 'script', name: '编' },
    { id: a.director, role: 'director', name: '导' },
    { id: a.maker, role: 'maker', name: '制' },
  ];
}

// 全部工位 agent id（用于后端校验传入的 agentId 是否合法）
export function agentIds(agents) {
  const a = agents || DEFAULT_AGENTS;
  return [a.script, a.director, a.maker].filter(Boolean);
}