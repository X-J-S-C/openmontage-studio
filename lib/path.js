// OpenMontage Studio - 路径安全工具（安全线，服务端）
// - sanitizeRelPath：项目内相对路径校验（拒绝 .. / 绝对路径 / 空段）
// - isValidWorkDir：工作台路径校验（拒绝相对/系统目录/数据目录本体或上级/8.3 短名/尾随空格点）
import { resolve } from "node:path";

// 校验并规范化项目内相对路径，拒绝目录穿越（..）、绝对路径、空段。
export function sanitizeRelPath(rel) {
  if (typeof rel !== "string" || rel.trim() === "") return null;
  const norm = String(rel).split(/[\\/]+/);
  if (norm.some((seg) => seg === "..")) return null;          // 目录穿越
  if (norm.some((seg) => seg === "")) return null;            // 空段
  if (norm.some((seg) => /^[A-Za-z]:/.test(seg))) return null; // 绝对路径（盘符 C:...）
  return norm.join("/");
}

// child 是否位于 parent 之内（含相等），用于工作台路径与 dataDir 包含关系
export function isSubPath(child, parent) {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  if (c === p) return true;
  return c.startsWith(p + "\\") || c.startsWith(p + "/");
}

// 校验工作台路径：绝对、无 .. 穿越段、拒绝盘符根/系统目录/8.3 短名/尾随空格点、拒绝 dataDir 本体或其上级
export function isValidWorkDir(workDir, dataDir) {
  try {
    let raw = String(workDir || "").trim();
    if (!raw) return { ok: false, reason: "路径为空" };
    if (!raw.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(raw)) {
      return { ok: false, reason: "必须为绝对路径" };
    }
    // 逐段去除尾随空格/点（Windows 折叠尾随空格/点，防中段绕过如 plugin-data. / Program Files )
    const segs = raw.split(/[\\/]+/).map((s) => s.replace(/[. ]+$/, ""));
    if (segs.some((s) => s === "..")) return { ok: false, reason: "不允许包含 .. 路径段" };
    // 8.3 短名段（含连字符，如 plugin-d~1）
    if (segs.some((s) => /^[A-Za-z0-9_~-]+~[0-9]+$/.test(s))) {
      return { ok: false, reason: "不允许使用 Windows 8.3 短名段" };
    }
    const abs = resolve(segs.join("/"));
    if (/^[A-Za-z]:[\\/]$/.test(abs) || abs === "/") {
      return { ok: false, reason: "不允许指向盘符根目录" };
    }
    if (/(^|[\\/])(Windows|Program Files|Program Files \(x86\)|System32)([\\/]|$)/i.test(abs)) {
      return { ok: false, reason: "不允许指向系统目录" };
    }
    if (dataDir) {
      const dd = resolve(dataDir);
      if (abs === dd) return { ok: false, reason: "不能指向插件数据目录本身" };
      if (isSubPath(dd, abs)) return { ok: false, reason: "不能指向插件数据目录的上级目录" };
      if (isSubPath(abs, dd)) return { ok: false, reason: "不能指向插件数据目录内部（元数据与工件目录需分离）" };
    }
    return { ok: true, value: abs };
  } catch (e) {
    return { ok: false, reason: "路径无效" };
  }
}