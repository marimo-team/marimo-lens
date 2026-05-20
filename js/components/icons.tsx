import type { ReactNode } from "react";

type IconProps = {
  size?: number;
  className?: string;
};

function IconSvg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7L12 3.5Z" />
      <path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </IconSvg>
  );
}

export function IconCrosshair(props: IconProps) {
  return (
    <IconSvg {...props}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <circle cx="12" cy="12" r="1.5" />
    </IconSvg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <IconSvg {...props}>
      <rect x="8" y="8" width="10" height="10" rx="2" />
      <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </IconSvg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path d="M5 12.5l4.2 4L19 7" />
    </IconSvg>
  );
}

export function IconScan(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path d="M7 3H5a2 2 0 0 0-2 2v2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </IconSvg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </IconSvg>
  );
}

export function IconX(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </IconSvg>
  );
}
