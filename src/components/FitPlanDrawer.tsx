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
    if (!open) return;
    setMode("proportional");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const allModes: string[] = ["proportional", "split", ...parents.map(p => p.id)];
    if (!viableModes.has(mode)) {
      const best = allModes.find(m => viableModes.has(m));
      if (best) setMode(best as DistributionMode);
    }
  }, [viableModes]);

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

        <div className="flex-1 space-y-6 py-4 px-1 overflow-y-auto">
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
          ) : proposal && !proposal.success ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kan inte lösas automatiskt</p>
              <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5 space-y-2">
                <p className="text-sm text-destructive font-semibold">
                  Planen kan inte gå ihop med nuvarande dagar.
                </p>
                <p className="text-sm text-muted-foreground">
                  Kvar att lösa: {proposal.meta.unfulfilledAfterFull} dagar.
                </p>
                <p className="text-sm text-muted-foreground">
                  Prova att minska antal dubbeldagar, korta ner en period, eller justera överföringen manuellt.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Kunde inte hitta en justering. Planen kanske redan går ihop.
            </p>
          )}

          {proposal && proposal.weeksTotal === 0 && proposal.success && (
            <p className="text-sm text-muted-foreground">
              Denna justering kräver ingen fördelning – omfördelningen av dagar räcker för att planen ska gå ihop.
            </p>
          )}

          {/* B) Distribution selection — only shown when week reductions are needed */}
          {(!proposal || proposal.weeksTotal > 0) && (
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
                      {!isViable && <span className="ml-1 text-xs">(ej kompatibelt med rekommenderad lösning)</span>}
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
                    <span className="ml-1 text-xs">(ej kompatibelt med rekommenderad lösning)</span>
                  )}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="proportional"
                  id="rescue-proportional"
                  disabled={!viableModes.has("proportional")}
                />
                <Label
                  htmlFor="rescue-proportional"
                  className={`text-sm ${!viableModes.has("proportional") ? "text-muted-foreground cursor-not-allowed" : "font-normal cursor-pointer"}`}
                >
                  Proportionerligt
                  {viableModes.has("proportional") && (
                    <span className="text-muted-foreground ml-1">(rekommenderas)</span>
                  )}
                  {!viableModes.has("proportional") && (
                    <span className="ml-1 text-xs">(ej kompatibelt med rekommenderad lösning)</span>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>
          )}

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
