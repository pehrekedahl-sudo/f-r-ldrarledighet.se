import { useMemo, useRef } from "react";
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
import { Download, ExternalLink, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  parentId: string;
  parentName: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  level: "Sjukpenningnivå" | "Lägstanivå";
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
        parentId: block.parentId,
        parentName,
        startDate: block.startDate,
        endDate: block.endDate,
        daysPerWeek: sicknessDays,
        level: "Sjukpenningnivå",
      });
    }
    if (lowestDays > 0) {
      steps.push({
        parentId: block.parentId,
        parentName,
        startDate: block.startDate,
        endDate: block.endDate,
        daysPerWeek: lowestDays,
        level: "Lägstanivå",
      });
    }
  }
  return steps;
}

export default function FKGuideDrawer({ open, onOpenChange, blocks, parents }: FKGuideDrawerProps) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const fkSteps = useMemo(() => buildFKSteps(blocks, parents), [blocks, parents]);

  const copyPeriod = (step: FKStep) => {
    const text = `Förälder: ${step.parentName}\nPeriod: ${formatDate(step.startDate)} – ${formatDate(step.endDate)}\nUttag: ${step.daysPerWeek} dagar/vecka · ${step.level}`;
    navigator.clipboard.writeText(text);
    toast({ description: "Period kopierad" });
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>FK-guide – Föräldrapenning</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #1a1a1a; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .subtitle { font-size: 13px; color: #666; margin-bottom: 24px; }
          .step-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 12px; page-break-inside: avoid; }
          .step-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
          .step-num { width: 28px; height: 28px; border-radius: 50%; background: #4A9B8E; color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
          .step-title { font-weight: 700; font-size: 14px; }
          .field { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
          .field-label { color: #666; }
          .field-value { font-weight: 600; font-family: monospace; }
          .warning { margin-top: 16px; padding: 12px; background: #FFF8F0; border-radius: 6px; font-size: 12px; }
          .warning li { margin-bottom: 6px; }
          @media print { body { padding: 16px; } .step-card { break-inside: avoid; } .no-print { display: none !important; } }
        </style>
      </head>
      <body>
        ${content.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  const hasP2 = parents.length >= 2;
  const p2Name = hasP2 ? parents[1].name : "";
  // Offset for step numbering: login=1, pappadagar=2 (if hasP2), then periods, warnings, PDF
  const stepOffset = hasP2 ? 2 : 1;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh] max-w-2xl mx-auto">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
            Så här anmäler du till FK – steg för steg
          </DrawerTitle>
          <DrawerDescription>
            Ingen API-koppling finns – du anmäler manuellt på Mina sidor. Vi har förberett all information åt dig.
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-2 flex-1">
          <div ref={printRef} className="space-y-3">
            {/* Hidden print title */}
            <h1 style={{ display: "none" }}>FK-guide – Föräldrapenning</h1>
            <p className="subtitle" style={{ display: "none" }}>Anmälningar att registrera på forsakringskassan.se</p>

            {/* STEP 1: Login */}
            <div className="rounded-lg bg-[#F5EDD8] p-4 space-y-2 step-card">
              <div className="step-header flex items-center gap-3">
                <span className="step-num w-7 h-7 rounded-full bg-[#4A9B8E] text-white text-sm flex items-center justify-center font-semibold shrink-0">1</span>
                <span className="step-title font-bold text-sm text-foreground">Logga in på Mina sidor</span>
              </div>
              <p className="text-sm text-[#2D3748] pl-10">
                Gå till Försäkringskassan → Mina sidor → Föräldrapenning → Anmäl ledighet.
              </p>
              <div className="pl-10 no-print">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => window.open("https://www.forsakringskassan.se/privatperson/foralder/foraldrapenning", "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Öppna FK →
                </Button>
              </div>
            </div>

            {/* STEP 2 (conditional): Pappadagar */}
            {hasP2 && (
              <div className="rounded-lg bg-[#F5EDD8] p-4 space-y-2 step-card">
                <div className="step-header flex items-center gap-3">
                  <span className="step-num w-7 h-7 rounded-full bg-[#4A9B8E] text-white text-sm flex items-center justify-center font-semibold shrink-0">2</span>
                  <span className="step-title font-bold text-sm text-foreground">Anmäl tillfällig föräldrapenning (10 dagar)</span>
                </div>
                <p className="text-sm text-[#2D3748] pl-10">
                  {p2Name} har rätt till 10 dagars tillfällig föräldrapenning i samband med barnets födelse. Dessa dagar ligger <strong>utanför</strong> 480-dagarsbudgeten och måste tas ut inom 60 dagar från födseln. De anmäls separat hos FK under "Tillfällig föräldrapenning".
                </p>
                <div className="pl-10 no-print">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => window.open("https://www.forsakringskassan.se/privatperson/foralder/tillfällig-föräldrapenning", "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Läs mer hos FK →
                  </Button>
                </div>
              </div>
            )}

            {/* Period cards */}
            {fkSteps.map((step, i) => {
              const stepNum = i + 1 + stepOffset;
              const isP1 = step.parentId === "p1";
              return (
                <div key={`${step.startDate}-${step.parentId}-${step.level}-${i}`} className="rounded-lg bg-[#F5EDD8] p-4 space-y-2 step-card">
                  <div className="step-header flex items-center gap-3">
                    <span className="step-num w-7 h-7 rounded-full bg-[#4A9B8E] text-white text-sm flex items-center justify-center font-semibold shrink-0">{stepNum}</span>
                    <span className="step-title font-bold text-sm text-foreground">
                      Anmäl {step.parentName}s period{fkSteps.filter(s => s.parentId === step.parentId).length > 1 ? ` (${step.level.toLowerCase()})` : ""}
                    </span>
                  </div>
                  <div className="pl-10">
                    <div className={`rounded-lg bg-white border border-border p-3 text-sm font-mono space-y-1 border-l-[3px] ${isP1 ? "border-l-[#4A9B8E]" : "border-l-[#E8735A]"}`}>
                      <div className="field flex justify-between">
                        <span className="field-label text-muted-foreground font-sans">Förälder</span>
                        <span className="field-value font-semibold font-sans">{step.parentName}</span>
                      </div>
                      <div className="field flex justify-between">
                        <span className="field-label text-muted-foreground font-sans">Period</span>
                        <span className="field-value font-semibold">{formatDate(step.startDate)} – {formatDate(step.endDate)}</span>
                      </div>
                      <div className="field flex justify-between">
                        <span className="field-label text-muted-foreground font-sans">Uttag</span>
                        <span className="field-value font-semibold font-sans">{step.daysPerWeek} dagar/vecka · <span className={isP1 ? "text-[#4A9B8E]" : "text-[#E8735A]"}>{step.level}</span></span>
                      </div>
                    </div>
                    <div className="mt-2 no-print">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-xs text-muted-foreground"
                        onClick={() => copyPeriod(step)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Kopiera period
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* STEP N+2: Warnings */}
            <div className="rounded-lg bg-[#F5EDD8] p-4 space-y-2 step-card">
              <div className="step-header flex items-center gap-3">
                <span className="step-num w-7 h-7 rounded-full bg-[#4A9B8E] text-white text-sm flex items-center justify-center font-semibold shrink-0">{fkSteps.length + 2}</span>
                <span className="step-title font-bold text-sm text-foreground">Viktigt att tänka på</span>
              </div>
              <ul className="pl-10 space-y-2 text-sm text-[#2D3748]">
                <li className="flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>Anmäl senast 2 månader innan ledigheten börjar</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>Du kan bara anmäla en period i taget – kom ihåg att anmäla {parents.length >= 2 ? `${parents[1].name}s` : "varje"} period separat</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>Föräldrapenning betalas inte ut automatiskt – varje ny period måste anmälas</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>Du kan ändra eller avboka en period fram till 1 dag innan den börjar</span>
                </li>
              </ul>
            </div>

            {/* STEP N+3: PDF */}
            <div className="rounded-lg bg-[#F5EDD8] p-4 space-y-2 step-card">
              <div className="step-header flex items-center gap-3">
                <span className="step-num w-7 h-7 rounded-full bg-[#4A9B8E] text-white text-sm flex items-center justify-center font-semibold shrink-0">{fkSteps.length + 3}</span>
                <span className="step-title font-bold text-sm text-foreground">Ladda ner som PDF</span>
              </div>
              <p className="text-sm text-[#2D3748] pl-10">
                Spara din plan som PDF att ha till hands när du anmäler.
              </p>
              <div className="pl-10 no-print">
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
              </div>
            </div>
          </div>
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost" size="sm">Stäng</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
