import type { SVGProps } from "react";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    sliders: <><path d="M4 7h5m4 0h7M4 17h10m4 0h2" /><circle cx="11" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    repeat: <><path d="M4 9a8 8 0 1 1 1 8M4 3v6h6" /></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    sparkle: <path d="M12 3c0 5-4 9-9 9 5 0 9 4 9 9 0-5 4-9 9-9-5 0-9-4-9-9Z" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.sparkle}</svg>;
}
