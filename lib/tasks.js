// OpenMontage Studio - 任务存储 (T9 / P2-5)
// 职责：制（或任意工位）汇报的执行任务状态，存插件 dataDir/tasks.json
// 结构：{ version:1, tasks: [{ id, projectId, stageId, status, progress, logSummary, artifactPaths, updatedAt }] }
// P2-5：并发安全——进程内串行写队列（promise 链）+ 写临时文件后 rename 原子替换，避免 load→save 并发丢写。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function tasksFile(dataDir) {
  return join(dataDir, 'tasks.json');
}

export function loadTasks(dataDir) {
  try {
    return JSON.parse(readFileSync(tasksFile(dataDir), 'utf-8'));
  } catch {
    return { version: 1, tasks: [] };
  }
}

export function saveTasks(dataDir, store) {
  mkdirSync(dataDir, { recursive: true });
  // 原子替换：先写临时文件再 rename，避免并发读到半写文件
  const tmp = tasksFile(dataDir) + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, tasksFile(dataDir));
}

// 进程内串行写队列：所有 load→save 排进同一 promise 链，保证不交错、不丢写
let writeQueue = Promise.resolve();

function enqueue(job) {
  const run = writeQueue.then(job, job);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

// 串行执行一次 读-改-写：对 dataDir 应用一次任务 diff（ID 已由调用方解析）
function applyDiff(dataDir, input) {
  return enqueue(() => {
    const store = loadTasks(dataDir);
    const now = new Date().toISOString();
    let task = (store.tasks || []).find((t) => t.id === input.taskId);
    if (!task) {
      task = { id: input.taskId, projectId: input.projectId, createdAt: now };
      store.tasks.push(task);
    }
    if (input.stageId !== undefined) task.stageId = input.stageId;
    if (input.status !== undefined) task.status = input.status;
    if (input.progress !== undefined) task.progress = input.progress;
    if (input.logSummary !== undefined) task.logSummary = input.logSummary;
    if (input.artifactPaths !== undefined) task.artifactPaths = input.artifactPaths;
    task.updatedAt = now;
    saveTasks(dataDir, store);
    return task;
  });
}

export function upsertTask(dataDir, input) {
  // 解析本次任务稳定 ID：有 taskId 用之（不存在则新建该 id），否则生成新 id。
  // 预览与串行落盘共用同一 id，保证 task-report 拿到的返回与持久化一致。
  const taskId = input.taskId || 't_' + randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  // 同步预览（保持原签名：同步返回 task 供即时回执）
  const store = loadTasks(dataDir);
  const pre = (store.tasks || []).find((t) => t.id === taskId);
  const task = pre ? pre : { id: taskId, projectId: input.projectId, createdAt: now };
  if (input.stageId !== undefined) task.stageId = input.stageId;
  if (input.status !== undefined) task.status = input.status;
  if (input.progress !== undefined) task.progress = input.progress;
  if (input.logSummary !== undefined) task.logSummary = input.logSummary;
  if (input.artifactPaths !== undefined) task.artifactPaths = input.artifactPaths;
  task.updatedAt = now;

  // 真正落盘进串行队列（load→apply→save + 原子写），并发安全
  applyDiff(dataDir, { ...input, taskId });
  return task;
}
