/**
 * 元数据缓存模块
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// 缓存目录
const CACHE_DIR = join(homedir(), '.cconvo');
const CACHE_FILE = join(CACHE_DIR, 'cache.json');

// 缓存版本，升级时递增以清除旧缓存
const CACHE_VERSION = 3;

// 单个文件的缓存条目
export interface CacheEntry {
  mtime: number; // 文件修改时间（毫秒）
  slug?: string;
  startTime: string; // ISO 格式
  endTime: string;
  messageCount: number;
  // 新增字段
  totalTokens: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  firstUserMessage?: string;
}

// 完整缓存结构
interface MetaCache {
  version: number;
  entries: Record<string, CacheEntry>;
}

// 内存缓存
let cache: MetaCache | null = null;
let isDirty = false;

// 加载缓存
export async function loadCache(): Promise<void> {
  if (cache) return;

  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(data) as MetaCache;

    // 版本不匹配则清除缓存
    if (parsed.version !== CACHE_VERSION) {
      cache = { version: CACHE_VERSION, entries: {} };
      isDirty = true;
    } else {
      cache = parsed;
    }
  } catch {
    // 缓存文件不存在或解析失败
    cache = { version: CACHE_VERSION, entries: {} };
  }
}

// 保存缓存
export async function saveCache(): Promise<void> {
  if (!cache || !isDirty) return;

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf-8');
    isDirty = false;
  } catch {
    // 保存失败不影响主流程
  }
}

// 获取缓存条目
export function getCacheEntry(filePath: string, mtime: number): CacheEntry | null {
  if (!cache) return null;

  const entry = cache.entries[filePath];
  if (entry && entry.mtime === mtime) {
    return entry;
  }
  return null;
}

// 设置缓存条目
export function setCacheEntry(filePath: string, entry: CacheEntry): void {
  if (!cache) {
    cache = { version: CACHE_VERSION, entries: {} };
  }
  cache.entries[filePath] = entry;
  isDirty = true;
}

// 删除缓存条目（对话文件已删除时调用）
export function removeCacheEntry(filePath: string): void {
  if (!cache) return;
  if (filePath in cache.entries) {
    delete cache.entries[filePath];
    isDirty = true;
  }
}
