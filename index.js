export default class OpenMontageStudioPlugin {
  async onload() {
    const { dataDir, log } = this.ctx;
    try {
      // 骨架阶段：仅初始化数据目录并挂 runtime 占位。
      // T3 起 dataDir 内存 Project/Stage/Artifact 元数据 JSON。
      this.ctx._omstudio = {
        ready: true,
        dataDir,
      };
      this.register(() => {
        delete this.ctx._omstudio;
      });
      log.info("openmontage-studio plugin loaded");
    } catch (e) {
      log.error("openmontage-studio load failed", e);
      this.ctx._omstudio = { ready: false, error: e && e.message ? e.message : String(e) };
    }
  }
}
