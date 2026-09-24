import { Badge } from '@/components/ui/badge';

interface StageBadgeProps {
  label: string;
  color: string;
  live?: boolean;
}

export function StageBadge({ label, color, live }: StageBadgeProps) {
  return (
    <Badge
      variant="outline"
      className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {label.toUpperCase()}
    </Badge>
  );
}
