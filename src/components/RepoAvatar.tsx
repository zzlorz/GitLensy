import { useMemo } from "react";
import { getRecentRepos } from "../api/tauri";

interface Props {
  repoName: string;
  repoPath: string;
  size?: number;
}

// 一组好看的颜色（亮/暗主题下都清晰），基于首字母稳定哈希选色
const PALETTE = [
  "#E53935", "#D81B60", "#8E24AA", "#5E35B1", "#3949AB",
  "#1E88E5", "#039BE5", "#00ACC1", "#00897B", "#43A047",
  "#7CB342", "#C0CA33", "#FDD835", "#FFB300", "#FB8C00",
  "#F4511E", "#6D4C41", "#757575", "#546E7A", "#00838F",
];

/** 基于字符串的稳定哈希 → 0..PALETTE.length-1 */
function hashColor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % PALETTE.length;
}

/**
 * 计算当前仓库在"相同首字母仓库"里的序号。
 * 合并 recent repos + 当前仓库，按路径排序后取相同首字母分组的索引。
 * 例如：有 MyApp 和 MyLib 两个仓库 → MyApp=1, MyLib=2
 */
function computeIndex(repoName: string, repoPath: string): number {
  const letter = (repoName[0] || "?").toUpperCase();
  const all = getRecentRepos().map((r) => ({ name: r.name, path: r.path }));
  // 确保当前仓库也参与计算
  if (!all.some((r) => r.path === repoPath)) {
    all.push({ name: repoName, path: repoPath });
  }
  // 同首字母的按路径排序
  const same = all
    .filter((r) => (r.name[0] || "?").toUpperCase() === letter)
    .sort((a, b) => a.path.localeCompare(b.path));
  const idx = same.findIndex((r) => r.path === repoPath);
  return idx >= 0 ? idx + 1 : 1;
}

export default function RepoAvatar({ repoName, repoPath, size = 18 }: Props) {
  const { letter, index, color } = useMemo(() => {
    const letter = (repoName[0] || "?").toUpperCase();
    const index = computeIndex(repoName, repoPath);
    const color = PALETTE[hashColor(repoName)];
    return { letter, index, color };
  }, [repoName, repoPath]);

  // 字号：根据尺寸自适应
  const fontSize = Math.max(8, Math.floor(size * 0.8));
  const radius = Math.max(3, Math.floor(size * 0.25));

  return (
    <div
      className="repo-avatar"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: radius,
        fontSize,
        flexShrink: 0,
      }}
      title={repoName}
    >
      <span className="repo-avatar-letter">{letter}</span>
      {index > 1 && <span className="repo-avatar-num">{index}</span>}
    </div>
  );
}
