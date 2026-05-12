/**
 * 从磁盘删除 Claude Code 本地对话（主 jsonl + 同名的 session 子目录）
 */

import { join, relative, resolve } from 'node:path';
import { rm, unlink, stat } from 'node:fs/promises';
import type { Project, ConversationSummary } from '../models/types.js';
import { loadCache, removeCacheEntry, saveCache } from '../utils/cache.js';

// 校验路径落在项目目录内，防止误删
function assertUnderProjectDir(projectDir: string, absolutePath: string): void {
  const base = resolve(projectDir);
  const target = resolve(absolutePath);
  const rel = relative(base, target);
  if (rel.startsWith('..') || rel === '') {
    throw new Error('Refusing to delete: path escapes project directory');
  }
}

/**
 * 删除对话文件及 sessionId 同名目录（含 subagents）
 */
export async function deleteConversationFromDisk(
  project: Project,
  conv: ConversationSummary
): Promise<void> {
  await loadCache();

  assertUnderProjectDir(project.dirPath, conv.filePath);

  const sessionDir = join(project.dirPath, conv.sessionId);
  assertUnderProjectDir(project.dirPath, sessionDir);

  await unlink(conv.filePath);
  removeCacheEntry(conv.filePath);

  try {
    const st = await stat(sessionDir);
    if (st.isDirectory()) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw e;
    }
  }

  await saveCache();
}

/**
 * 从内存中的 Project 移除一条对话摘要（扫描结果对象）
 */
export function removeConversationFromProject(
  project: Project,
  conv: ConversationSummary
): void {
  const idx = project.conversations.findIndex(
    c => c.sessionId === conv.sessionId && c.filePath === conv.filePath
  );
  if (idx < 0) return;
  project.conversations.splice(idx, 1);
  project.totalConversations = project.conversations.length;
  project.totalSize -= conv.fileSize;
}
