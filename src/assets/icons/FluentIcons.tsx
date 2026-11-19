import type { SVGProps } from "react";

type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

export function FluentTableIcon({ size = 20, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 9.5H21M9.5 9.5V20M15.5 9.5V20M3 14.75H21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function FluentClusterIcon({ size = 20, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="17" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="17" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9.5 8.5L11 14.2M14.5 8.5L13 14.2M10 7H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function FluentRecipeIcon({ size = 20, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 8.5H16M8 12.5H16M8 16.5H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FluentColumnIcon({ size = 20, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="8.5" y="4" width="7" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M4 6V18M20 6V18M8.5 9.5H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function FluentPanelLeftIcon({ size = 16, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 3.5V16.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function FluentPanelRightIcon({ size = 16, ...props }: IconSvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 3.5V16.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
