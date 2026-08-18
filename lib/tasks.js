// OpenMontage Studio - 任务存储 (T9)
// 职责：制（或任意工位）汇报的执行任务状态，存插件 dataDir/tasks.json
// 结构：{ version:1, tasks: [{ id, projectId, stageId, status, progress, logSummary, artifactPaths, updatedAt }] }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  writeFileSync(tasksFile(dataDir), JSON.stringify(store, null, 2), 'utf-8');
}

export function upsertTask(dataDir, input) {
  const store = loadTasks(dataDir);
  const now = new Date().toISOString();
  let task;
  if (input.taskId) {
    task = (store.tasks || []).find((t) => t.id === input.taskId);
    if (!task) {
      task = { id: input.taskId, projectId: input.projectId, createdAt: now };
      store.tasks.push(task);
    }
  } else {
    task = { id: 't_' + randomUUID().slice(0, 8), projectId: input.projectId, createdAt: now };
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
}
