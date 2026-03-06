/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ RESCUE / AUTO-JUSTERA — UI COMPONENT                            │
 * │                                                                  │
 * │ All computation lives in src/lib/rescue/computeRescueProposal.  │
 * │ This file is UI-only. No policy imports.                        │
 * │ All displayed numbers come from proposal.meta (single source).  │
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
  const [viableModes, setViableModes] = useState<Set<string>>(
    new Set(["proportional", "split", ...parents.map(p => p.id)])
  );
  const [redundantModes, setRedundantModes] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (!open) return;
    setViableModes(new Set(["proportional", "split", ...parents.map(p => p.id)]));
    setRedundantModes(new Set());
    const timer = setTimeout(() => {
      const viable = new Set<string>();
      const redundant = new Set<string>();
      const results: Record<string, { success: boolean; blockSignature: string }> = {};

      const modesToTest: string[] = ["proportional", "split", ...parents.map(p => p.id)];
      for (const m of modesToTest) {
        const probe = computeRescueProposal(blocks, parents, constants, transfer, m as DistributionMode);
        if (probe && probe.success) {
          const sig = probe.newBlocks
            .map(b => `${b.parentId}:${b.startDate}:${b.endDate}:${b.daysPerWeek}`)
            .sort()
            .join("|");
          results[m] = { success: true, blockSignature: sig };
          viable.add(m);
        } else {
          results[m] = { success: false, blockSignature: "" };
        }
      }

      const specificParentSigs = parents
        .filter(p => results[p.id]?.success)
        .map(p => results[p.id].blockSignature);

      for (const m of ["proportional", "split"]) {
        if (!results[m]?.success) continue;
        const sig = results[m].blockSignature;
        if (specificParentSigs.includes(sig)) {
          viable.delete(m);
          redundant.add(m);
        }
      }

      if (results["split"]?.success && results["proportional"]?.success) {
        if (results["split"].blockSignature === results["proportional"].blockSignature) {
          viable.delete("split");
          redundant.add("split");
        }
      }

      setViableModes(viable);
      setRedundantModes(redundant);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, blocks, parents, constants, transfer]);

  const handleApply = () => {
    if (!proposal || !proposal.success) return;
    // Apply the EXACT verified proposal — no recomputation
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
          {/* A) Summary — all numbers from proposal.meta */}
          {computing ? (
            <p className="text-sm text-muted-foreground italic animate-pulse">Beräknar…</p>
          ) : proposal ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rekommenderad lösning</p>
              <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {proposal.meta.transferDays > 0 && proposal.weeksTotal > 0 ? (
                    <>Planen kräver omfördelning av dagar och att{" "}
                    <span className="font-semibold text-foreground">
                      {parents.find(p => p.id === proposal.proposedTransfer?.toParentId)?.name}
                    </span>{" "}
                    minskar uttagstakten för att gå ihop.</>
                  ) : proposal.meta.transferDays > 0 ? (
                    "Planen kräver omfördelning av dagar mellan er för att gå ihop."
                  ) : proposal.weeksTotal > 0 ? (
                    "Planen kräver att uttagstakten minskas för att gå ihop."
                  ) : (
                    "Planen behöver justeras."
                  )}
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
              {parents.map(p => {
                const isViable = viableModes.has(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <RadioGroupItem value={p.id} id={`rescue-${p.id}`} disabled={!isViable} />
                    <Label
                      htmlFor={`rescue-${p.id}`}
                      className={`text-sm ${!isViable ? "text-muted-foreground cursor-not-allowed" : "font-normal cursor-pointer"}`}
                    >
                      Endast {p.name}
                      {!isViable && <span className="ml-1 text-xs">(kan inte lösa bristen ensam)</span>}
                    </Label>
                  </div>
                );
              })}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="split" id="rescue-split" disabled={!viableModes.has("split")} />
                <Label
                  htmlFor="rescue-split"
                  className={`text-sm ${!viableModes.has("split") ? "text-muted-foreground cursor-not-allowed" : "font-normal cursor-pointer"}`}
                >
                  50/50 mellan er
                  {!viableModes.has("split") && (
                    <span className="ml-1 text-xs">
                      {redundantModes.has("split")
                        ? "(samma resultat som ett annat val)"
                        : "(kan inte lösa bristen jämnt)"}
                    </span>
                  )}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="proportional" id="rescue-proportional" />
                <Label htmlFor="rescue-proportional" className="text-sm font-normal cursor-pointer">
                  Proportionerligt <span className="text-muted-foreground">(rekommenderas)</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* C) Detail preview — derived from proposal reductions + transfer */}
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
                      Kvar att lösa: {proposal.meta.unfulfilledAfterFull} dagar
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Förslaget gick inte hela vägen – prova en annan fördelning.
                    </p>
                  </>
                )}
                <p className="text-sm text-muted-foreground">
                  {proposal.deltaMonthly >= 0 ? "+" : ""}{proposal.deltaMonthly.toLocaleString()} kr/mån i genomsnitt
                </p>
              </div>
            </div>
          )}

          {/* D) Debug panel — single source of truth from meta */}
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

                {proposal.reductions.length > 0 && (
                  <div>
                    <p className="font-semibold text-foreground/70">Reductions ({proposal.reductions.length})</p>
                    {proposal.reductions.map((r, i) => (
                      <p key={i}>{r.parentId} | {r.startDate}→{r.endDate} | {r.oldDpw}→{r.newDpw} | {r.weeksCount}w</p>
                    ))}
                  </div>
                )}

                <p className="font-semibold text-foreground/70">Verified proposal (single source)</p>
                <div className="pl-3 space-y-0.5">
                  <p>mode = {proposal.meta.mode}</p>
                  {proposal.meta.weights && (
                    <p>weights: {proposal.meta.weights.p1Id.slice(0,8)}={proposal.meta.weights.p1Weight}, {proposal.meta.weights.p2Id.slice(0,8)}={proposal.meta.weights.p2Weight}</p>
                  )}
                  <p>shortageBefore = {proposal.meta.shortageBefore}</p>
                  <p>maxTransfer = {proposal.meta.maxTransfer}</p>
                  <p>transferDays = {proposal.meta.transferDays}</p>
                  <p>shortageAfterTransfer = {proposal.meta.shortageAfterTransfer} (engine)</p>
                  <p>weeksTotalApplied = {proposal.meta.weeksTotalApplied} (from Σ reductions)</p>
                  <p>perParentWeeksApplied = {JSON.stringify(proposal.meta.perParentWeeksApplied)}</p>
                  <p className={
                    Object.values(proposal.meta.perParentWeeksApplied).reduce((s, v) => s + v, 0) === proposal.meta.weeksTotalApplied
                      ? "text-primary" : "text-destructive font-bold"
                  }>
                    Σ perParent = {Object.values(proposal.meta.perParentWeeksApplied).reduce((s, v) => s + v, 0)} {
                      Object.values(proposal.meta.perParentWeeksApplied).reduce((s, v) => s + v, 0) === proposal.meta.weeksTotalApplied ? "✓" : "⚠"
                    }
                  </p>
                  <p className={proposal.meta.unfulfilledAfterFull === 0 ? "text-primary" : "text-destructive font-bold"}>
                    unfulfilledAfterFull = {proposal.meta.unfulfilledAfterFull} (engine) {proposal.meta.unfulfilledAfterFull === 0 ? "✓" : "⚠"}
                  </p>
                  <p className="text-foreground/50 pt-1">
                    Check: transferDays({proposal.meta.transferDays}) + weeksTotalApplied({proposal.meta.weeksTotalApplied}) = {proposal.meta.transferDays + proposal.meta.weeksTotalApplied} vs shortageBefore({proposal.meta.shortageBefore}) {
                      proposal.meta.transferDays + proposal.meta.weeksTotalApplied >= proposal.meta.shortageBefore ? "≥ ✓" : "< ⚠"
                    }
                  </p>
                  <p>transferConfig = {proposal.meta.transferConfig}</p>
                </div>
              </div>
            </details>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button disabled={!proposal || !proposal.success} onClick={handleApply}>
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
