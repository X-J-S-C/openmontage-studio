// OpenMontage Studio - 工件类型映射（P2-4 单一来源，服务端）
// 从扩展名推断工件类型。客户端 assets/app.js 的 guessType 属前端另一侧，标为债务不在本文件。
const TYPE_BY_EXT = {
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'm4v', 'ts'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'],
  audio: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus'],
  script: ['md', 'txt', 'docx', 'doc', 'pdf', 'pptx'],
  subtitle: ['srt', 'ass', 'vtt'],
  data: ['json', 'yaml', 'yml', 'csv', 'xml'],
};

export function inferType(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const [t, exts] of Object.entries(TYPE_BY_EXT)) {
    if (exts.includes(ext)) return t;
  }
  return 'asset';
}
