import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Download, ExternalLink } from "lucide-react";

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  isOverlap?: boolean;
};

type Parent = {
  id: string;
  name: string;
};

type FKStep = {
  key: string;
  parentId: string;
  parentName: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  level: "Sjukpenningnivå" | "Lägstanivå";
  isOverlap?: boolean;
};

interface FKGuideDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}-${m}-${d}`;
}

function buildFKSteps(blocks: Block[], parents: Parent[]): FKStep[] {
  const parentMap = new Map(parents.map(p => [p.id, p.name]));
  const sorted = [...blocks]
    .filter(b => b.daysPerWeek > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const steps: FKStep[] = [];
  for (const block of sorted) {
    const parentName = parentMap.get(block.parentId) ?? block.parentId;
    const lowestDays = block.lowestDaysPerWeek ?? 0;
    const sicknessDays = block.daysPerWeek - lowestDays;

    if (sicknessDays > 0) {
      steps.push({
        key: `${block.startDate}-${block.parentId}-sjp`,
        parentId: block.parentId,
        parentName,
        startDate: block.startDate,
        endDate: block.endDate,
        daysPerWeek: sicknessDays,
        level: "Sjukpenningnivå",
        isOverlap: block.isOverlap,
      });
    }
    if (lowestDays > 0) {
      steps.push({
        key: `${block.startDate}-${block.parentId}-lag`,
        parentId: block.parentId,
        parentName,
        startDate: block.startDate,
        endDate: block.endDate,
        daysPerWeek: lowestDays,
        level: "Lägstanivå",
        isOverlap: block.isOverlap,
      });
    }
  }
  return steps;
}

/** Generate a simple hash from block data to scope localStorage */
function planHash(blocks: Block[]): string {
  const raw = blocks.map(b => `${b.parentId}${b.startDate}${b.endDate}${b.daysPerWeek}`).join("|");
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "fk_" + Math.abs(h).toString(36);
}

type ChecklistItem = { id: string; label: string; type: "action" | "period"; parentId?: string };

export default function FKGuideDrawer({ open, onOpenChange, blocks, parents }: FKGuideDrawerProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const fkSteps = useMemo(() => buildFKSteps(blocks, parents), [blocks, parents]);
  const hasP2 = parents.length >= 2;
  const p2Name = hasP2 ? parents[1].name : "";

  // Build a flat checklist of all items
  const allItems = useMemo<ChecklistItem[]>(() => {
    const items: ChecklistItem[] = [{ id: "login", label: "Logga in på Mina sidor", type: "action" }];
    if (hasP2) items.push({ id: "pappadagar", label: "Anmäl tillfällig föräldrapenning (10 dagar)", type: "action" });
    for (const step of fkSteps) {
      items.push({ id: step.key, label: `${step.parentName}: ${formatDate(step.startDate)} – ${formatDate(step.endDate)}`, type: "period", parentId: step.parentId });
    }
    return items;
  }, [fkSteps, hasP2]);

  // Persist checked state per plan
  const storageKey = useMemo(() => planHash(blocks), [blocks]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setChecked(new Set(JSON.parse(saved)));
      else setChecked(new Set());
    } catch { setChecked(new Set()); }
  }, [storageKey]);

  const toggle = useCallback((id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  const doneCount = allItems.filter(i => checked.has(i.id)).length;
  const totalCount = allItems.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Find first unchecked item id for "next" highlight
  const nextItemId = allItems.find(i => !checked.has(i.id))?.id ?? null;

  // Group period steps by parent
  const stepsByParent = useMemo(() => {
    const map = new Map<string, FKStep[]>();
    for (const s of fkSteps) {
      if (!map.has(s.parentId)) map.set(s.parentId, []);
      map.get(s.parentId)!.push(s);
    }
    return map;
  }, [fkSteps]);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    // Build summary table HTML
    const summaryRows = parents.map(p => {
      const pSteps = fkSteps.filter(s => s.parentId === p.id);
      const periods = pSteps.length;
      const startD = pSteps.length ? pSteps[0].startDate : "–";
      const endD = pSteps.length ? pSteps[pSteps.length - 1].endDate : "–";
      return `<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:600">${p.name}</td><td style="padding:6px 12px;border:1px solid #ddd">${periods} perioder</td><td style="padding:6px 12px;border:1px solid #ddd">${startD} – ${endD}</td></tr>`;
    }).join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Försäkringskassan-guide – Föräldrapenning</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #1a1a1a; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .subtitle { font-size: 13px; color: #666; margin-bottom: 16px; }
          table { border-collapse: collapse; margin-bottom: 24px; width: 100%; }
          th { text-align: left; padding: 6px 12px; border: 1px solid #ddd; background: #f5f5f5; font-size: 13px; }
          .checklist-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #eee; }
          .checkbox-print { width: 16px; height: 16px; border: 2px solid #999; border-radius: 3px; flex-shrink: 0; margin-top: 1px; }
          .parent-header { font-weight: 700; font-size: 15px; margin-top: 20px; margin-bottom: 8px; padding-left: 4px; }
          .parent-header-p1 { border-left: 3px solid #4A9B8E; padding-left: 8px; }
          .parent-header-p2 { border-left: 3px solid #E8735A; padding-left: 8px; }
          .period-detail { color: #555; font-family: monospace; font-size: 12px; }
          @media print { body { padding: 16px; } }
        </style>
      </head>
      <body>
        <h1>Försäkringskassan-guide – Föräldrapenning</h1>
        <p class="subtitle">Checklista för anmälan på forsakringskassan.se</p>
        <table>
          <thead><tr><th>Förälder</th><th>Perioder</th><th>Tidsram</th></tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>
        ${content.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  const isNext = (id: string) => id === nextItemId;

  const stepCardClass = (id: string) =>
    `rounded-lg p-4 space-y-2 step-card transition-colors ${
      checked.has(id) ? "bg-[#F5EDD8]/60 opacity-75" : isNext(id) ? "bg-[#E8F5E9] ring-2 ring-[#4A9B8E]/40" : "bg-[#F5EDD8]"
    }`;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh] max-w-2xl mx-auto">
        <DrawerHeader className="text-left space-y-3">
          <DrawerTitle className="text-xl" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
            Anmäl till Försäkringskassan
          </DrawerTitle>
          <DrawerDescription>
            Bocka av varje steg allt&nbsp;eftersom du anmäler på Mina sidor.
          </DrawerDescription>
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{doneCount} av {totalCount} klara</span>
              <span>{progressPct} %</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-2 flex-1">
          <div ref={printRef} className="space-y-3">

            {/* STEP: Login */}
            <div className={stepCardClass("login")}>
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={checked.has("login")}
                  onCheckedChange={() => toggle("login")}
                  className="mt-0.5 no-print"
                />
                <div className="checkbox-print" style={{ display: "none" }} />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">Logga in på Mina sidor</span>
                    {isNext("login") && <span className="text-[10px] font-semibold bg-[#4A9B8E] text-white px-1.5 py-0.5 rounded no-print">Nästa</span>}
                  </div>
                  <p className="text-sm text-[#2D3748]">
                    Gå till Försäkringskassan → Mina sidor → Föräldrapenning → Anmäl ledighet.
                  </p>
                  <div className="no-print">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => window.open("https://www.forsakringskassan.se/privatperson/foralder/foraldrapenning", "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Öppna Försäkringskassan →
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* STEP: Pappadagar */}
            {hasP2 && (
              <div className={stepCardClass("pappadagar")}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={checked.has("pappadagar")}
                    onCheckedChange={() => toggle("pappadagar")}
                    className="mt-0.5 no-print"
                  />
                  <div className="checkbox-print" style={{ display: "none" }} />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">Anmäl tillfällig föräldrapenning (10 dagar)</span>
                      {isNext("pappadagar") && <span className="text-[10px] font-semibold bg-[#4A9B8E] text-white px-1.5 py-0.5 rounded no-print">Nästa</span>}
                    </div>
                    <p className="text-sm text-[#2D3748]">
                      {p2Name} har rätt till 10 dagars tillfällig föräldrapenning i samband med barnets födelse. Dessa dagar ligger <strong>utanför</strong> 480-dagarsbudgeten och måste tas ut inom 60 dagar från födseln.
                    </p>
                    <div className="no-print">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => window.open("https://www.forsakringskassan.se/privatperson/foralder/tillfällig-föräldrapenning", "_blank")}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Läs mer hos Försäkringskassan →
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Period steps grouped by parent */}
            {parents.map(parent => {
              const pSteps = stepsByParent.get(parent.id);
              if (!pSteps || pSteps.length === 0) return null;
              const isP1 = parent.id === "p1";
              const color = isP1 ? "#4A9B8E" : "#E8735A";
              return (
                <div key={parent.id} className="space-y-2">
                  <div className={`flex items-center gap-2 pt-2`}>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <h3 className="font-bold text-sm text-foreground">{parent.name}s perioder</h3>
                    <span className="text-xs text-muted-foreground">({pSteps.filter(s => checked.has(s.key)).length}/{pSteps.length})</span>
                  </div>
                  {pSteps.map(step => (
                    <div key={step.key} className={stepCardClass(step.key)}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={checked.has(step.key)}
                          onCheckedChange={() => toggle(step.key)}
                          className="mt-0.5 no-print"
                        />
                        <div className="checkbox-print" style={{ display: "none" }} />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              {formatDate(step.startDate)} – {formatDate(step.endDate)}
                            </span>
                            {isNext(step.key) && <span className="text-[10px] font-semibold bg-[#4A9B8E] text-white px-1.5 py-0.5 rounded no-print">Nästa</span>}
                          </div>
                          <div className={`rounded-lg bg-white border border-border p-3 text-sm font-mono space-y-1 border-l-[3px]`} style={{ borderLeftColor: color }}>
                            <div className="field flex justify-between">
                              <span className="field-label text-muted-foreground font-sans">Uttag</span>
                              <span className="field-value font-semibold font-sans">{step.daysPerWeek} dagar/vecka</span>
                            </div>
                            <div className="field flex justify-between">
                              <span className="field-label text-muted-foreground font-sans">Nivå</span>
                              <span className="field-value font-semibold font-sans" style={{ color }}>{step.level}</span>
                            </div>
                          </div>
                          {step.isOverlap && (
                            <div className="mt-1 rounded-md bg-white/70 border border-[#E8B89A] p-2.5 text-xs text-[#2D3748] space-y-1">
                              <p className="font-semibold">🔄 Dubbeldag – båda föräldrarna anmäler samma period var för sig</p>
                              <p>Varje förälder loggar in på sitt eget konto och anmäler perioden med samma start-/slutdatum och uttag.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Warnings */}
            <div className="rounded-lg bg-[#F5EDD8] p-4 space-y-2">
              <div className="space-y-2">
                <span className="font-bold text-sm text-foreground">Viktigt att tänka på</span>
                  <ul className="space-y-2 text-sm text-[#2D3748]">
                    <li className="flex items-start gap-2">
                      <span className="shrink-0">⚠️</span>
                      <span>Du kan bara anmäla en period i taget – kom ihåg att anmäla {hasP2 ? `${p2Name}s` : "varje"} period separat</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0">⚠️</span>
                      <span>Du kan ändra eller avboka en period fram till 1 dag innan den börjar</span>
                    </li>
                  </ul>
              </div>
            </div>
          </div>
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handlePrint}
            disabled={fkSteps.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Ladda ner PDF
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" size="sm">Stäng</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
