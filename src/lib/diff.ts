/**
 * Unified diff（git diff 输出）的轻量解析器，供 Diff 查看器渲染。
 * 只做展示级解析：按文件分组 + 行分类，不做语义合并。
 */

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface FileDiff {
  path: string; // b/ 侧路径（新路径）
  oldPath: string;
  isBinary: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // diff --git a/path b/path
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      current = {
        path: m?.[2] ?? line.slice(11),
        oldPath: m?.[1] ?? '',
        isBinary: false,
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true;
      continue;
    }
    // 头部元信息行不渲染
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue;
    }
    if (line.startsWith('@@')) {
      current.lines.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ kind: 'add', text: line });
    } else if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ kind: 'del', text: line });
    } else {
      current.lines.push({ kind: 'context', text: line });
    }
  }
  return files;
}

/** 超大文件截断阈值（行）——防止渲染卡死 */
export const MAX_RENDER_LINES = 2000;
