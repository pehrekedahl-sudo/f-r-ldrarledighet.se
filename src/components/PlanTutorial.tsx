import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface TutorialStep {
  targetId: string | null;
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [
  {
    targetId: "plan-hero",
    title: "Översikt",
    body: "Här ser du en sammanfattning av er plan: hur länge pengarna räcker, snittinkomst per månad, och hur många dagar varje förälder har kvar. Du kan dela planen eller börja om.",
  },
  {
    targetId: "plan-timeline",
    title: "Tidslinjen",
    body: "Tidslinjen visar era ledighetsblock i kronologisk ordning. Dra i kanterna för att ändra längd, eller klicka på ett block för att redigera dagar per vecka. Det påverkar direkt hur länge dagarna räcker och vad ni får i ersättning.",
  },
  {
    targetId: "adjust-panel",
    title: "Justera planen",
    body: "Här finjusterar ni planen: ändra växlingsdatum mellan föräldrar, spara dagar som reserv, överföra dagar sinsemellan eller lägga till dubbeldagar. Varje ändring uppdaterar tidslinjen och ersättningen direkt.",
  },
  {
    targetId: "benefit-panel",
    title: "Ersättning per förälder",
    body: "Här ser ni vad varje förälder får utbetalt per månad i snitt och hur mycket av lönen det täcker. Ni kan även lägga till arbetsgivarens tillägg (löneuppfyllnad) för att se den riktiga nettoskillnaden.",
  },
  {
    targetId: null,
    title: "Klart! 🎉",
    body: "Nu är ni redo att planera! Ni kan alltid ta fram den här guiden igen via ❓-knappen uppe till höger.",
  },
];

const STORAGE_KEY = "planTutorialSeenV1";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PlanTutorial({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);

  const currentStep = STEPS[step];

  // Add/remove highlight class on target element
  const applyHighlight = useCallback((targetId: string | null) => {
    // Remove previous highlight
    if (highlightedRef.current) {
      highlightedRef.current.classList.remove("tutorial-highlight");
      highlightedRef.current = null;
    }
    if (!targetId) {
      setRect(null);
      return;
    }
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.classList.add("tutorial-highlight");
          highlightedRef.current = el;
          setRect(el.getBoundingClientRect());
        });
      });
    } else {
      setRect(null);
    }
  }, []);

  // Cleanup highlight on unmount or close
  useEffect(() => {
    if (!open && highlightedRef.current) {
      highlightedRef.current.classList.remove("tutorial-highlight");
      highlightedRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    applyHighlight(currentStep.targetId);
  }, [open, step, currentStep.targetId, applyHighlight]);

  // Update rect on scroll/resize
  useEffect(() => {
    if (!open || !currentStep.targetId) return;
    const update = () => {
      const el = highlightedRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, currentStep.targetId]);

  const finish = useCallback(() => {
    if (highlightedRef.current) {
      highlightedRef.current.classList.remove("tutorial-highlight");
      highlightedRef.current = null;
    }
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    onClose();
  }, [onClose]);

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const skip = () => finish();

  if (!open) return null;

  const hasTarget = currentStep.targetId !== null && rect !== null;

  // Position tooltip below the target, or centered
  const tooltipStyle: React.CSSProperties = hasTarget
    ? {
        position: "fixed",
        top: Math.min(rect!.bottom + 16, window.innerHeight - 220),
        left: Math.max(16, Math.min(rect!.left, window.innerWidth - 380)),
        zIndex: 60,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
      };

  return (
    <>
      {/* Transparent click-blocker */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={skip}
      />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="bg-card rounded-xl shadow-lg border border-border p-5 max-w-sm w-[calc(100vw-2rem)] animate-in fade-in-0 zoom-in-95 duration-200"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{currentStep.title}</h3>
          <button onClick={skip} className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1 rounded-md">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{currentStep.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={skip}>
                Hoppa över
              </Button>
            )}
            <Button size="sm" className="text-xs h-7 px-4" onClick={next}>
              {step < STEPS.length - 1 ? "Nästa" : "Klar!"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function usePlanTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "true") {
        const t = setTimeout(() => setShowTutorial(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  return { showTutorial, setShowTutorial };
}
