// Small inline icons (16px grid, 1.6px strokes) and the Seyrin mark.
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Seyrin: an S drawn in one stroke, with the agent's spark above it. */
export function SeyrinMark({ size = 26, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id="seyrin-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d1b33" />
          <stop offset="1" stopColor="#6b5cf0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#seyrin-mark-g)" />
      <path
        d="M20.6 11.2c-.9-1.5-2.6-2.3-4.6-2.3-2.6 0-4.4 1.4-4.4 3.3 0 4.6 9.4 2.7 9.4 7.4 0 2.1-2 3.6-4.9 3.6-2.2 0-4-.9-5-2.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="23.6" cy="7.6" r="1.9" fill="#c9c2ff" />
    </svg>
  );
}

export const DocIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 1.8h5.2L12 4.6v9.6H4z" />
    <path d="M9 1.8v3h3M6 8h4M6 10.6h4" />
  </Icon>
);

export const KaneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
    <path d="M1.8 5.4h12.4M5.4 9.4l1.7 1.6 3.4-3.2" />
  </Icon>
);

export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.4 4.4 2 8l3.4 3.6M10.6 4.4 14 8l-3.4 3.6M9.2 2.8 6.8 13.2" />
  </Icon>
);

export const ReplyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.4 3.6 2.4 7.4l4 3.8" />
    <path d="M2.6 7.4h6.6c2.6 0 4.4 1.8 4.4 4.6" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.6 13.2 3.6v4c0 3.2-2.2 5.6-5.2 6.8-3-1.2-5.2-3.6-5.2-6.8v-4z" />
    <path d="m5.8 8 1.6 1.6 2.8-3" />
  </Icon>
);

export const ShieldOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.6 13.2 3.6v4c0 3.2-2.2 5.6-5.2 6.8-3-1.2-5.2-3.6-5.2-6.8v-4z" />
    <path d="m6.2 6.2 3.6 3.6M9.8 6.2 6.2 9.8" />
  </Icon>
);

export const HandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.4 8.2V3.6a1 1 0 0 1 2 0v3.8M7.4 7V2.6a1 1 0 0 1 2 0V7M9.4 7.2V3.6a1 1 0 0 1 2 0v5.6c0 2.8-1.8 4.8-4.4 4.8-1.8 0-2.8-.9-3.8-2.6L2 8.8a1 1 0 0 1 1.7-1l1.7 1.8" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.2 8.4 3 3 6.6-6.8" pathLength={1} />
  </Icon>
);

export const CrossIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6" />
  </Icon>
);

export const SealIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.4 9.6 2.6l2-.1.6 1.9 1.6 1.2-.6 1.9.6 1.9-1.6 1.2-.6 1.9-2 -.1L8 13.6l-1.6-1.2-2 .1-.6-1.9-1.6-1.2.6-1.9-.6-1.9 1.6-1.2.6-1.9 2 .1z" pathLength={1} />
    <path d="m5.8 7.8 1.6 1.6 2.8-3" pathLength={1} />
  </Icon>
);

export const BugIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.6" y="4.8" width="6.8" height="8.6" rx="3.4" />
    <path d="M6 4.8a2 2 0 0 1 4 0M2.4 8.6h2.2M11.4 8.6h2.2M3 5.2l1.8 1.2M13 5.2l-1.8 1.2M3 12.4l1.8-1.2M13 12.4l-1.8-1.2M8 7.4v6" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.8c.4 3 1.2 3.8 4.2 4.2-3 .4-3.8 1.2-4.2 4.2-.4-3-1.2-3.8-4.2-4.2 3-.4 3.8-1.2 4.2-4.2z" />
    <path d="M12.6 10.6c.2 1.3.6 1.7 1.8 1.8-1.2.2-1.6.6-1.8 1.8-.2-1.2-.6-1.6-1.8-1.8 1.2-.1 1.6-.5 1.8-1.8z" />
  </Icon>
);

export const ArrowOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.6 3.4h7v7M12.4 3.6 3.6 12.4" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3 2.2 5.8 5 8.6" />
    <path d="M2.4 5.8h6.8a4 4 0 0 1 0 8H6" />
  </Icon>
);

export const RetryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 3.2v3.4H9.6" />
    <path d="M12.8 6.4A5.2 5.2 0 1 0 13 10" />
  </Icon>
);

export const PersonIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="5.2" r="2.6" />
    <path d="M2.8 13.8c.6-2.6 2.6-4 5.2-4s4.6 1.4 5.2 4" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.4 8S3.8 3.4 8 3.4 14.6 8 14.6 8 12.2 12.6 8 12.6 1.4 8 1.4 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 2.6 13.4 5.4 5.8 13H3v-2.8z" />
    <path d="M9.2 4 12 6.8" />
  </Icon>
);

export const GlobeOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.4" cy="8.6" r="5.4" />
    <path d="M2 8.6h10.8M7.4 3.2c1.6 1.6 2.2 3.4 2.2 5.4s-.6 3.8-2.2 5.4c-1.6-1.6-2.2-3.4-2.2-5.4s.6-3.8 2.2-5.4" />
    <path d="M11 1.6h3.4V5M14.2 1.8 11.6 4.4" />
  </Icon>
);

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.8 1.6 3.4 9h4.2l-.8 5.4L12.6 7H8.2z" />
  </Icon>
);

export const WandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2.4 13.6 8-8M9 4l1.4-1.4M12 7l1.4-1.4" />
    <path d="M12.2 1.6v2M11.2 2.6h2M13.6 9.4v1.6M12.8 10.2h1.6M5.6 1.8v1.4M4.9 2.5h1.4" />
  </Icon>
);

export const KindIcon = ({ kind, ...p }: IconProps & { kind: string }) => {
  if (kind === 'document') return <DocIcon {...p} />;
  if (kind === 'bug_report') return <BugIcon {...p} />;
  return <WandIcon {...p} />;
};

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 3.6 4.4 4.4L6 12.4" />
  </Icon>
);

export const ComposeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.4 8.6V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1h4.4" />
    <path d="M11.6 1.8 14.2 4.4 8.4 10.2H5.8V7.6z" />
  </Icon>
);

export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" />
    <path d="m4.4 6.2 2 1.8-2 1.8M8 10h3.4" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2 14.4 13.2H1.6z" />
    <path d="M8 6.4v3M8 11.4v.1" />
  </Icon>
);

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 9.2 3.6 3.2h8.8l1.8 6v3.6a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8z" />
    <path d="M1.8 9.2h3.6l1 1.6h3.2l1-1.6h3.6" />
  </Icon>
);

export const LeafIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 13c0-6 3.6-9.6 10-10-.4 6.4-4 10-10 10z" />
    <path d="M3 13 8.6 7.4" />
  </Icon>
);

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
    <circle cx="5.6" cy="6.2" r="1.2" />
    <path d="m2.4 12 4-3.8 2.8 2.4 1.8-1.6 2.8 2.6" />
  </Icon>
);

export const ToolIcon = ({ tool, ...p }: IconProps & { tool: string }) => {
  if (tool === 'docs') return <DocIcon {...p} />;
  if (tool === 'kane') return <KaneIcon {...p} />;
  if (tool === 'code') return <CodeIcon {...p} />;
  if (tool === 'reply') return <ReplyIcon {...p} />;
  return <SparkIcon {...p} />;
};

export const RiskIcon = ({ risk, ...p }: IconProps & { risk: string }) => {
  if (risk === 'read') return <EyeIcon {...p} />;
  if (risk === 'create') return <PlusIcon {...p} />;
  if (risk === 'modify') return <PencilIcon {...p} />;
  return <GlobeOutIcon {...p} />;
};

export const DecisionIcon = ({ decision, ...p }: IconProps & { decision: string }) => {
  if (decision === 'auto') return <BoltIcon {...p} />;
  if (decision === 'approve') return <HandIcon {...p} />;
  return <ShieldOffIcon {...p} />;
};
