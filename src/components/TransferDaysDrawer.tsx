import { useState, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { simulatePlan } from "@/lib/simulatePlan";
import type { Block } from "@/lib/adjustmentPolicy";

type Parent = {
  id: string;
  name: string;
  monthlyIncomeFixed: number;
  monthlyIncomeVariableAvg?: number;
  has240Days: boolean;
};

type Constants = {
  SGI_CAP_ANNUAL: number;
  LOWEST_LEVEL_DAILY_AMOUNT: number;
  BASIC_LEVEL_DAILY_AMOUNT: number;
  SICKNESS_RATE: number;
  REDUCTION: number;
  SICKNESS_DAILY_MAX?: number;
};

type Transfer = { fromParentId: string; toParentId: string; sicknessDays: number; lowestDays?: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: Block[];
  parents: Parent[];
  constants: Constants;
  transfer: Transfer | null;
  onApply: (newTransfer: Transfer | null) => void;
};

function getTransfers(t: Transfer | null) {
  return t && (t.sicknessDays > 0 || (t.lowestDays ?? 0) > 0) ? [t] : [];
}

function calcAvgMonthly(parentsResult: any[]): number {
  const allM = parentsResult.flatMap((pr: any) => pr.monthlyBreakdown);
  const total = allM.reduce((s: number, m: any) => s + m.grossAmount, 0);
  const months = allM.filter((m: any) => m.grossAmount > 0).length;
  return months > 0 ? total / months : 0;
}

const TransferDaysDrawer = ({ open, onOpenChange, blocks, parents, constants, transfer, onApply }: Props) => {
  const simResult = useMemo(() => {
    if (blocks.length === 0) return null;
    try {
      return simulatePlan({ parents, blocks, transfers: getTransfers(transfer), constants });
    } catch {
      return null;
    }
  }, [blocks, parents, constants, transfer]);

  const remainingByParent = useMemo(() => {
    const map: Record<string, { total: number; lowest: number }> = {};
    if (simResult) {
      for (const pr of simResult.parentsResult) {
        map[pr.parentId] = {
          total: Math.round(pr.remaining.sicknessTransferable + pr.remaining.sicknessReserved + pr.remaining.lowest),
          lowest: Math.round(pr.remaining.lowest),
        };
      }
    }
    return map;
  }, [simResult]);

  const transferableByParent = useMemo(() => {
    const map: Record<string, { sickness: number; lowest: number }> = {};
    if (!simResult) return map;
    try {
      const noTransferResult = simulatePlan({ parents, blocks, transfers: [], constants });
      for (const pr of noTransferResult.parentsResult) {
        map[pr.parentId] = {
          sickness: Math.round(pr.remaining.sicknessTransferable),
          lowest: Math.round(pr.remaining.lowest),
        };
      }
    } catch {
      for (const pr of simResult.parentsResult) {
        map[pr.parentId] = {
          sickness: Math.round(pr.remaining.sicknessTransferable),
          lowest: Math.round(pr.remaining.lowest),
        };
      }
    }
    return map;
  }, [simResult, parents, blocks, constants]);

  const defaultGiver = useMemo(() => {
    if (parents.length < 2) return parents[0]?.id ?? "";
    const r0 = remainingByParent[parents[0].id]?.total ?? 0;
    const r1 = remainingByParent[parents[1].id]?.total ?? 0;
    return r0 >= r1 ? parents[0].id : parents[1].id;
  }, [parents, remainingByParent]);

  const [giverId, setGiverId] = useState(defaultGiver);
  const [days, setDays] = useState(0);
  const [lowestDays, setLowestDays] = useState(0);

  useEffect(() => {
    if (open) {
      if (transfer && (transfer.sicknessDays > 0 || (transfer.lowestDays ?? 0) > 0)) {
        setGiverId(transfer.fromParentId);
        setDays(transfer.sicknessDays);
        setLowestDays(transfer.lowestDays ?? 0);
      } else {
        setGiverId(defaultGiver);
        setDays(0);
        setLowestDays(0);
      }
    }
  }, [open, transfer, defaultGiver]);

  const receiverId = parents.find(p => p.id !== giverId)?.id ?? "";
  const giverName = parents.find(p => p.id === giverId)?.name ?? "?";
  const receiverName = parents.find(p => p.id === receiverId)?.name ?? "?";
  const maxSicknessDays = transferableByParent[giverId]?.sickness ?? 0;
  const maxLowestDays = transferableByParent[giverId]?.lowest ?? 0;

  const preview = useMemo(() => {
    if ((days <= 0 && lowestDays <= 0) || blocks.length === 0) return null;
    const newTransfer: Transfer = { fromParentId: giverId, toParentId: receiverId, sicknessDays: days, lowestDays };
    try {
      const withNew = simulatePlan({ parents, blocks, transfers: [newTransfer], constants });
      const without = simulatePlan({ parents, blocks, transfers: [], constants });
      const giverAfter = withNew.parentsResult.find(pr => pr.parentId === giverId);
      const receiverAfter = withNew.parentsResult.find(pr => pr.parentId === receiverId);
      const giverRemaining = giverAfter
        ? Math.round(giverAfter.remaining.sicknessTransferable + giverAfter.remaining.sicknessReserved + giverAfter.remaining.lowest)
        : 0;
      const receiverRemaining = receiverAfter
        ? Math.round(receiverAfter.remaining.sicknessTransferable + receiverAfter.remaining.sicknessReserved + receiverAfter.remaining.lowest)
        : 0;
      const avgWithNew = calcAvgMonthly(withNew.parentsResult);
      const avgWithout = calcAvgMonthly(without.parentsResult);
      const deltaMonthly = Math.round(avgWithNew - avgWithout);
      return { giverRemaining, receiverRemaining, deltaMonthly };
    } catch {
      return null;
    }
  }, [days, lowestDays, giverId, receiverId, blocks, parents, constants]);

  const isUnchanged =
    (transfer?.fromParentId === giverId &&
      transfer?.toParentId === receiverId &&
      transfer?.sicknessDays === days &&
      (transfer?.lowestDays ?? 0) === lowestDays) ||
    (days === 0 && lowestDays === 0 && (!transfer || (transfer.sicknessDays === 0 && (transfer.lowestDays ?? 0) === 0)));

  const handleApply = () => {
    if (days <= 0 && lowestDays <= 0) {
      onApply(null);
    } else {
      onApply({ fromParentId: giverId, toParentId: receiverId, sicknessDays: days, lowestDays: lowestDays > 0 ? lowestDays : undefined });
    }
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Överför dagar</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Flytta dagar från en förälders kvot till den andres.
          </p>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-4 overflow-y-auto">
          {/* Current quotas */}
          <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-2">
            <p className="text-sm font-medium">Nuvarande kvoter</p>
            {parents.map(p => (
              <p key={p.id} className="text-sm text-muted-foreground">
                {p.name}: {remainingByParent[p.id]?.total ?? 0} dagar kvar (varav {remainingByParent[p.id]?.lowest ?? 0} lägstanivå)
              </p>
            ))}
            {transfer && (transfer.sicknessDays > 0 || (transfer.lowestDays ?? 0) > 0) && (
              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                Aktiv överföring: {transfer.sicknessDays > 0 ? `${transfer.sicknessDays} sjukpenningdagar` : ""}
                {transfer.sicknessDays > 0 && (transfer.lowestDays ?? 0) > 0 ? " + " : ""}
                {(transfer.lowestDays ?? 0) > 0 ? `${transfer.lowestDays} lägstanivådagar` : ""}
                {" "}från {parents.find(p => p.id === transfer.fromParentId)?.name ?? "?"} till{" "}
                {parents.find(p => p.id === transfer.toParentId)?.name ?? "?"}
              </p>
            )}
          </div>

          {/* Direction */}
          <div className="space-y-2">
            <Label>Riktning</Label>
            <RadioGroup value={giverId} onValueChange={(v) => { setGiverId(v); setDays(0); setLowestDays(0); }}>
              {parents.length >= 2 && (
                <>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value={parents[0].id} id="dir-0" />
                    <Label htmlFor="dir-0" className="font-normal cursor-pointer">
                      {parents[0].name} → {parents[1].name}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value={parents[1].id} id="dir-1" />
                    <Label htmlFor="dir-1" className="font-normal cursor-pointer">
                      {parents[1].name} → {parents[0].name}
                    </Label>
                  </div>
                </>
              )}
            </RadioGroup>
          </div>

          {/* Sickness days amount */}
          <div className="space-y-2">
            <Label htmlFor="transfer-days-input">Sjukpenningdagar</Label>
            <Input
              id="transfer-days-input"
              type="number"
              min={0}
              max={maxSicknessDays}
              value={days || ""}
              onChange={(e) => {
                const v = Math.max(0, Math.min(maxSicknessDays, Math.floor(Number(e.target.value) || 0)));
                setDays(v);
              }}
            />
            <p className="text-xs text-muted-foreground">Max {maxSicknessDays} sjukpenningdagar</p>
          </div>

          {/* Lowest-level days amount */}
          <div className="space-y-2">
            <Label htmlFor="transfer-lowest-input">Lägstanivådagar</Label>
            <Input
              id="transfer-lowest-input"
              type="number"
              min={0}
              max={maxLowestDays}
              value={lowestDays || ""}
              onChange={(e) => {
                const v = Math.max(0, Math.min(maxLowestDays, Math.floor(Number(e.target.value) || 0)));
                setLowestDays(v);
              }}
            />
            <p className="text-xs text-muted-foreground">Max {maxLowestDays} lägstanivådagar</p>
          </div>

          {/* Preview */}
          {preview && (days > 0 || lowestDays > 0) && (
            <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-1">
              <p className="text-sm font-medium">Förhandsgranskning</p>
              <p className="text-sm text-muted-foreground">
                {giverName} efter överföring: {preview.giverRemaining} dagar
              </p>
              <p className="text-sm text-muted-foreground">
                {receiverName} efter överföring: {preview.receiverRemaining} dagar
              </p>
              <p className="text-sm text-muted-foreground">
                Snitt/mån ändras med: {preview.deltaMonthly >= 0 ? "+" : ""}{preview.deltaMonthly} kr/mån
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="flex gap-3 pt-4 border-t border-border">
          <Button onClick={handleApply} disabled={isUnchanged}>
            Applicera ändring
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Avbryt</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default TransferDaysDrawer;
