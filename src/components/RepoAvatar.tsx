import { useMemo } from "react";

interface Props {
  repoName: string;
  /** 同一首字母分组内的编号（从 0 开始）；不传或为 null 时不显示数字 */
  index?: number | null;
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

export default function RepoAvatar({ repoName, index = null, size = 18 }: Props) {
  const { letter, color } = useMemo(() => {
    const letter = (repoName.trim()[0] || "?").toUpperCase();
    const color = PALETTE[hashColor(repoName)];
    return { letter, color };
  }, [repoName]);

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
      {index !== null && <span className="repo-avatar-num">{index}</span>}
    </div>
  );
}
