import { useState, useCallback, useRef, useEffect } from "react";
import { addDays, startOfISOWeek, compareDates } from "@/utils/dateOnly";

type DragState = {
  blockId: string;
  edge: "start" | "end";
  startX: number;
  originalDate: string;
} | null;

type UseTimelineDragOptions = {
  timelineStartMs: number;
  totalMs: number;
  onBlockResize?: (blockId: string, newStart: string, newEnd: string) => void;
};

export function useTimelineDrag({ timelineStartMs, totalMs, onBlockResize }: UseTimelineDragOptions) {
  const [dragState, setDragState] = useState<DragState>(null);
  const [dragPreviewDate, setDragPreviewDate] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const pctToDate = useCallback(
    (pct: number): string => {
      const ms = timelineStartMs + (pct / 100) * totalMs;
      const d = new Date(ms);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    },
    [timelineStartMs, totalMs]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, blockId: string, edge: "start" | "end", originalDate: string) => {
      if (!onBlockResize) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragState({ blockId, edge, startX: e.clientX, originalDate });
      setDragPreviewDate(originalDate);
    },
    [onBlockResize]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragState || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const rawDate = pctToDate(pct);
      // Snap to nearest Monday
      const snapped = startOfISOWeek(rawDate);
      setDragPreviewDate(snapped);
    },
    [dragState, pctToDate]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragState || !dragPreviewDate || !onBlockResize) {
        setDragState(null);
        setDragPreviewDate(null);
        return;
      }
      // Only fire if date actually changed
      if (dragPreviewDate !== dragState.originalDate) {
        onBlockResize(dragState.blockId, dragState.edge === "start" ? dragPreviewDate : "", dragState.edge === "end" ? dragPreviewDate : "");
      }
      setDragState(null);
      setDragPreviewDate(null);
    },
    [dragState, dragPreviewDate, onBlockResize]
  );

  useEffect(() => {
    if (!dragState) return;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, handlePointerMove, handlePointerUp]);

  return {
    timelineRef,
    dragState,
    dragPreviewDate,
    handlePointerDown,
    isDragging: dragState !== null,
  };
}
