// Simple outline icons for the back office (24×24, currentColor).
type IconProps = { className?: string };

function Svg({ className = "h-5 w-5", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z" /></Svg>
);
export const InvoiceIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h7M9 16h7" /></Svg>
);
export const BoxIcon = (p: IconProps) => (
  <Svg {...p}><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
);
export const PulseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 12h4l2-6 4 12 2-6h6" /></Svg>
);
export const GearIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Svg>
);
export const DotsIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>
);
export const LogoutIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" /></Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
