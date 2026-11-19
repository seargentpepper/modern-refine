import type { ComponentType, CSSProperties } from "react";

interface IconProps {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ icon: IconComp, size = 16, className, style }: IconProps) {
  return <IconComp size={size} strokeWidth={1.75} className={className} style={style} />;
}
