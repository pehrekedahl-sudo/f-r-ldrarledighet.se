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

function formatDateReadable(iso: string): string {
  const months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const [y, m, d] = iso.split("-");
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
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
  const printRef = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => buildFKSteps(blocks, parents), [blocks, parents]);

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
          .step { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 12px; page-break-inside: avoid; }
          .step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
          .step-num { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
          .parent-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
          .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
          .dot-p1 { background: #4A9B8E; }
          .dot-p2 { background: #E8735A; }
          .field { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
          .field:last-child { border-bottom: none; }
          .field-label { color: #666; }
          .field-value { font-weight: 600; }
          .level-sjuk { color: #4A9B8E; }
          .level-lagst { color: #E8735A; }
          .tip { background: #f8f8f8; border-radius: 6px; padding: 12px; margin-top: 24px; font-size: 12px; color: #555; }
          .tip strong { color: #333; }
          @media print { body { padding: 16px; } .step { break-inside: avoid; } }
        </style>
      </head>
      <body>
        ${content.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg">FK-guide</DrawerTitle>
          <DrawerDescription>
            Steg-för-steg instruktioner för att registrera din plan på Försäkringskassan
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-2 flex-1">
          {/* Printable content */}
          <div ref={printRef}>
            <h1 style={{ display: "none" }}>FK-guide – Föräldrapenning</h1>
            <p className="subtitle" style={{ display: "none" }}>
              Anmälningar att registrera på forsakringskassan.se
            </p>

            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Inga perioder att registrera. Lägg till block i din plan först.
              </p>
            ) : (
              <div className="space-y-3">
                {steps.map((step, i) => {
                  const isP1 = step.parentId === "p1";
                  return (
                    <div
                      key={`${step.startDate}-${step.parentId}-${step.level}-${i}`}
                      className="step rounded-lg border border-border bg-card p-4"
                    >
                      <div className="step-header flex items-center justify-between mb-3">
                        <span className="step-num text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Steg {i + 1} av {steps.length}
                        </span>
                        <span className="parent-badge flex items-center gap-1.5 font-semibold text-sm">
                          <span className={`dot inline-block w-2 h-2 rounded-full ${isP1 ? "dot-p1 bg-[#4A9B8E]" : "dot-p2 bg-[#E8735A]"}`} />
                          {step.parentName}
                        </span>
                      </div>

                      <div className="space-y-0">
                        <div className="field flex items-center justify-between py-1.5 border-b border-border/50 text-sm">
                          <span className="field-label text-muted-foreground">Startdatum</span>
                          <span className="field-value font-semibold font-mono text-sm">{formatDate(step.startDate)}</span>
                        </div>
                        <div className="field flex items-center justify-between py-1.5 border-b border-border/50 text-sm">
                          <span className="field-label text-muted-foreground">Slutdatum</span>
                          <span className="field-value font-semibold font-mono text-sm">{formatDate(step.endDate)}</span>
                        </div>
                        <div className="field flex items-center justify-between py-1.5 border-b border-border/50 text-sm">
                          <span className="field-label text-muted-foreground">Dagar per vecka</span>
                          <span className="field-value font-semibold">{step.daysPerWeek}</span>
                        </div>
                        <div className="field flex items-center justify-between py-1.5 text-sm">
                          <span className="field-label text-muted-foreground">Nivå</span>
                          <span className={`field-value font-semibold ${step.level === "Sjukpenningnivå" ? "text-[#4A9B8E] level-sjuk" : "text-[#E8735A] level-lagst"}`}>
                            {step.level}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Instruction tip */}
                <div className="tip rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <span>💡</span> Så här gör du
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Logga in på <strong>forsakringskassan.se</strong> med BankID</li>
                    <li>Gå till <strong>Föräldrapenning → Anmäl föräldrapenning</strong></li>
                    <li>Fyll i uppgifterna från varje steg ovan — ett steg = en anmälan</li>
                    <li>Om ni är två föräldrar, logga in med respektive BankID</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => window.open("https://www.forsakringskassan.se/privatperson/foralder/foraldrapenning", "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
            Öppna FK
          </Button>
          <Button className="flex-1 gap-2" onClick={handlePrint} disabled={steps.length === 0}>
            <Download className="h-4 w-4" />
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
