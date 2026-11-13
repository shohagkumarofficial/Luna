import React, { useEffect, useMemo, useRef, useState } from "react";

interface StreamingTextProps {
  text: string;
  messageId: string;
  animateOnMount?: boolean;
  cursorColorClass?: string;
}

function splitGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new (Intl as any).Segmenter("bn", { granularity: "grapheme" });
      return Array.from(segmenter.segment(text), (s: any) => s.segment);
    } catch {
      // Fallback to code-point split
    }
  }
  return Array.from(text);
}

const completedMessageIds = new Set<string>();

export const StreamingText: React.FC<StreamingTextProps> = ({
  text,
  messageId,
  animateOnMount = true,
  cursorColorClass = "bg-pink-400",
}) => {
  const graphemes = useMemo(() => splitGraphemes(text), [text]);
  const shouldAnimate = animateOnMount && !completedMessageIds.has(messageId);
  const [visibleCount, setVisibleCount] = useState<number>(
    shouldAnimate ? 0 : graphemes.length
  );
  const lastIdRef = useRef<string>(messageId);

  useEffect(() => {
    lastIdRef.current = messageId;

    if (!animateOnMount || completedMessageIds.has(messageId)) {
      completedMessageIds.add(messageId);
      setVisibleCount(graphemes.length);
      return;
    }

    setVisibleCount(0);

    if (graphemes.length === 0) {
      completedMessageIds.add(messageId);
      return;
    }

    // Adaptive speed: crisp & natural for short replies, smoothly paced for longer replies
    const total = graphemes.length;
    const stepSize = total > 220 ? 3 : total > 110 ? 2 : 1;
    const intervalMs = total > 220 ? 16 : 22;

    let current = 0;
    const timer = window.setInterval(() => {
      current = Math.min(total, current + stepSize);
      setVisibleCount(current);
      if (current >= total) {
        completedMessageIds.add(messageId);
        window.clearInterval(timer);
      }
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [messageId, text, graphemes.length, animateOnMount]);

  const isTyping = visibleCount < graphemes.length;
  const shownText = isTyping ? graphemes.slice(0, visibleCount).join("") : text;

  return (
    <span>
      {shownText}
      {isTyping && (
        <span
          aria-hidden="true"
          className={`inline-block w-[2px] h-[1em] ml-0.5 align-middle animate-pulse rounded-full ${cursorColorClass}`}
        />
      )}
    </span>
  );
};
