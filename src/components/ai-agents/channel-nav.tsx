"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSubAccount } from "@/context/sub-account-context";
import {
  VISIBLE_AI_CHANNELS,
  buildChannelHref,
} from "@/components/ai-agents/channels";
import { cn } from "@/lib/utils";

/**
 * Horizontal tabs nav for the AI Agents area. Renders once at the layout
 * level so every channel page shares the same chrome. Active state matches
 * the current pathname against each channel's URL.
 */
export function ChannelNav() {
  const pathname = usePathname();
  const { subAccountId } = useSubAccount();
  const baseHref = `/sa/${subAccountId}/ai-agents`;

  return (
    <div className="flex overflow-x-auto border-b">
      {VISIBLE_AI_CHANNELS.map((channel) => {
        const href = buildChannelHref(subAccountId, channel);
        // Overview is the exact /ai-agents URL. Sub-channels match the
        // prefix so /ai-agents/sms/anything-future still highlights SMS.
        const isActive =
          channel.id === "overview"
            ? pathname === baseHref
            : pathname.startsWith(href);
        const Icon = channel.icon;
        return (
          <Link
            key={channel.id}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {channel.label}
          </Link>
        );
      })}
    </div>
  );
}
