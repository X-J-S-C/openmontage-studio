// OpenMontage Studio - 管线列表 (V2)
// 独立文件：避免旧模块缓存问题（Hana server 进程缓存了旧版 pipelines.js）
// 职责：列出 pipeline_defs 目录下的全部管线（yaml 文件名去扩展名）

// 列出 pipeline_defs 目录下的全部管线（yaml 文件名去扩展名）
export async function listPipelines(resources, repoPath) {
  if (!repoPath) {
    throw new Error('repoPath 缺失');
  }
  const dirPath = repoPath.replace(/[\\/]+$/, '') + '/pipeline_defs';
  let entries = [];
  try {
    // 优先 list；部分实现返回目录条目
    const result = await resources.list({ kind: 'local-file', path: dirPath });
    entries = (result && (result.entries || result.items || result.files)) || [];
  } catch (e) {
    // list 失败退回 read 目录
    try {
      const result = await resources.read({ kind: 'local-file', path: dirPath });
      const raw = result && (result.content || result.text);
      const str = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
      entries = [];
      const m = str.match(/[A-Za-z0-9_-]+\.yaml/g);
      if (m) entries = m.map((f) => ({ name: f }));
    } catch (e2) {
      throw new Error('读取管线目录失败: ' + (e2 && e2.message ? e2.message : String(e2)));
    }
  }
  return entries
    .filter((en) => en && typeof en.name === 'string' && en.name.endsWith('.yaml'))
    .map((en) => ({ id: en.name.replace(/\.yaml$/, ''), name: en.name.replace(/\.yaml$/, '') }));
}
