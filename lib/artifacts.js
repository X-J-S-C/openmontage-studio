// OpenMontage Studio - 工件登记共享逻辑（P2-3 单一来源，服务端）
// 职责：登记工件到指定阶段；同 stage 同 path → version+1（重写场景）。
// 供 tools/artifact-register.js、tools/file-import.js、lib/scan.js 复用。
import { randomUUID } from 'node:crypto';

export function registerArtifact(project, stageId, relPath, type, title) {
  const stage = (project.stages || []).find((s) => s.stageId === stageId);
  if (!stage) return { ok: false, error: '阶段不存在: ' + stageId };
  if (!Array.isArray(stage.artifacts)) stage.artifacts = [];

  const same = stage.artifacts.filter((a) => a.path === relPath);
  const version = same.length > 0 ? Math.max(...same.map((a) => a.version || 1)) + 1 : 1;

  const artifact = {
    id: 'a_' + randomUUID().slice(0, 8),
    type: type || 'asset',
    path: relPath,
    version,
    stageId,
    title: title || String(relPath || '').split('/').pop(),
    createdAt: new Date().toISOString(),
  };
  stage.artifacts.push(artifact);
  project.updatedAt = new Date().toISOString();
  return { ok: true, artifact };
}
