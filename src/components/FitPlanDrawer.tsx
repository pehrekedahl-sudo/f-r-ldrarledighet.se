/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — UI COMPONENT                            │
 * │                                                                  │
 * │ All computation lives in src/lib/rescue/computeRescueProposal.  │
 * │ This file is UI-only. No policy imports.                        │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  computeRescueProposal,
  type Block,
  type Parent,
  type Constants,
  type Transfer,
  type DistributionMode,
  type Proposal,
} from "@/lib/rescue/computeRescueProposal";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Transfer | null;
  onApply: (newBlocks: Block[], newTransfer: Transfer | null) => void;
};

const FitPlanDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const [mode, setMode] = useState<DistributionMode>("proportional");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setComputing(true);
    setProposal(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const result = computeRescueProposal(blocks, parents, constants, transfer, mode);
      setProposal(result);
      setComputing(false);
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, mode, blocks, parents, constants, transfer]);

  useEffect(() => {
    if (open) setMode("proportional");
  }, [open]);

  const handleApply = () => {
    if (!proposal) return;
    onApply(proposal.newBlocks, proposal.proposedTransfer ?? transfer);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Auto-justera så planen går ihop</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          {/* A) Summary */}
          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">Beräknar…</p>
          ) : proposal ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekommenderad lösning</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {proposal.transferDays > 0 && proposal.weeksTotal > 0
                    ? "Planen kräver omfördelning av dagar mellan er och justering av uttagstakt för att gå ihop."
                    : proposal.transferDays > 0
                    ? "Planen kräver omfördelning av dagar mellan er för att gå ihop."
                    : proposal.weeksTotal > 0
                    ? "Planen kräver att ni minskar uttagstakten i delar av ledigheten för att gå ihop."
                    : "Planen behöver justeras."}
                </p>
                <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                  {proposal.actionsText.map((t, i) => <li key={i}>{t}</li>)}
                  {proposal.actionsText.length === 0 && <li>Inga justeringar behövs</li>}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kunde inte hitta en justering. Planen kanske redan går ihop.
            </p>
          )}

          {/* B) Distribution selection */}
          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Välj hur justeringen ska fördelas</p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as DistributionMode)}>
              {parents.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <RadioGroupItem value={p.id} id={`rescue-${p.id}`} />
                  <Label htmlFor={`rescue-${p.id}`} className="text-sm font-normal cursor-pointer">Endast {p.name}</Label>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="split" id="rescue-split" />
                <Label htmlFor="rescue-split" className="text-sm font-normal cursor-pointer">50/50 mellan er</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="proportional" id="rescue-proportional" />
                <Label htmlFor="rescue-proportional" className="text-sm font-normal cursor-pointer">
                  Proportionerligt <span className="text-muted-foreground">(rekommenderas)</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* C) Detail preview */}
          {!computing && proposal && (
            <div className="space-y-4 border-t border-border pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detta innebär</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <ul className="text-sm text-foreground space-y-1.5 list-disc list-inside">
                  {proposal.detailText.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
              <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                {proposal.success ? (
                  <p className="text-sm text-primary font-semibold">✅ Planen går ihop</p>
                ) : (
                  <>
                    <p className="text-sm text-destructive font-semibold">
                      ❌ Planen går inte helt ihop
                    </p>
                    <p className="text-sm text-destructive/80">
                      Kvar att lösa: {proposal.debug.unfulfilledAfterFull} dagar
                    </p>
                  </>
                )}
                <p className="text-sm text-muted-foreground">
                  {proposal.deltaMonthly >= 0 ? "+" : ""}{proposal.deltaMonthly.toLocaleString()} kr/mån i genomsnitt
                </p>
              </div>
            </div>
          )}

          {/* D) Debug panel */}
          {!computing && proposal && (
            <details className="border-t border-border pt-4">
              <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
                <ChevronDown className="h-3 w-3" />
                DEBUG (rescue)
              </summary>
              <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-3 space-y-3 font-mono text-[10px] text-muted-foreground max-h-60 overflow-y-auto">
                <div>
                  <p className="font-semibold text-foreground/70">Blocks BEFORE ({proposal.debugBefore.length})</p>
                  {proposal.debugBefore.map((b, i) => (
                    <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold text-foreground/70">Blocks AFTER ({proposal.debugAfter.length})</p>
                  {proposal.debugAfter.map((b, i) => (
                    <p key={i}>{b.id.slice(0,12)} | {b.parentId} | {b.startDate}→{b.endDate} | dpw={b.daysPerWeek}</p>
                  ))}
                </div>
                <p className="font-semibold text-foreground/70">Decomposition</p>
                <div className="pl-3 space-y-0.5">
                  <p>missingDaysTotal = {proposal.missingDaysTotal}</p>
                  <p>maxTransfer = {proposal.debug.maxTransfer}</p>
                  <p>transferDays = {proposal.transferDays}</p>
                  <p>missingAfterTransferOnly = {proposal.missingAfterTransferOnly}</p>
                  <p>weeksTotal = {proposal.weeksTotal}</p>
                  <p>perParentWeeks = {JSON.stringify(proposal.perParentWeeks)}</p>
                  <p>sumPerParentWeeks = {proposal.debug.sumPerParentWeeks}</p>
                  <p>rawReductionWeeks = {proposal.debug.rawReductionWeeks}</p>
                  <p className={proposal.debug.consistent ? "text-primary" : "text-destructive font-bold"}>
                    Check: {proposal.transferDays} + {proposal.weeksTotal} = {proposal.transferDays + proposal.weeksTotal} {proposal.debug.consistent ? "✓" : `≠ ${proposal.missingDaysTotal} ⚠ MISMATCH`}
                  </p>
                  <p className={proposal.debug.sumPerParentWeeks === proposal.weeksTotal ? "text-primary" : "text-destructive font-bold"}>
                    Σ perParent = {proposal.debug.sumPerParentWeeks} {proposal.debug.sumPerParentWeeks === proposal.weeksTotal ? "✓" : `≠ ${proposal.weeksTotal} ⚠ MISMATCH`}
                  </p>
                </div>
                <p className="font-semibold text-foreground/70 mt-2">Ground truth</p>
                <div className="pl-3 space-y-0.5">
                  <p>shortageBefore = {proposal.debug.shortageBefore}</p>
                  <p>missingAfterTransferOnly = {proposal.missingAfterTransferOnly}</p>
                  <p>unfulfilledAfterFull = <span className={proposal.debug.unfulfilledAfterFull === 0 ? "text-primary" : "text-destructive"}>{proposal.debug.unfulfilledAfterFull}</span></p>
                  <p>shortageAfter = <span className={proposal.debug.shortageAfter === 0 ? "text-primary" : "text-destructive"}>{proposal.debug.shortageAfter}</span></p>
                </div>
              </div>
            </details>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!proposal} onClick={handleApply}>
            Applicera ändring
          </Button>
          <SheetClose asChild>
            <Button variant="ghost">Avbryt</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default FitPlanDrawer;
