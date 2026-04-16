import { useEffect, useState } from "react";
import { z } from "zod";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/hooks/useUser";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MessageSquare, Bug, Heart, HelpCircle } from "lucide-react";

const FEEDBACK_TYPES = [
  { value: "suggestion", label: "Förslag", icon: MessageSquare },
  { value: "bug", label: "Bugg", icon: Bug },
  { value: "praise", label: "Beröm", icon: Heart },
  { value: "other", label: "Annat", icon: HelpCircle },
] as const;

const feedbackSchema = z.object({
  type: z.enum(["suggestion", "bug", "praise", "other"]),
  message: z
    .string()
    .trim()
    .min(1, "Skriv gärna något så vi förstår vad du menar")
    .max(1000, "Max 1000 tecken"),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Ange en giltig e-postadress")
    .optional()
    .or(z.literal("")),
});

type FeedbackType = (typeof FEEDBACK_TYPES)[number]["value"];

interface FeedbackDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FeedbackDrawer = ({ open, onOpenChange }: FeedbackDrawerProps) => {
  const { user } = useUser();
  const location = useLocation();
  const [type, setType] = useState<FeedbackType>("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill email when user is logged in / drawer opens
  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? "");
    }
  }, [open, user]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setType("suggestion");
        setMessage("");
      }, 200);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = feedbackSchema.safeParse({ type, message, email });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Något blev fel — kolla fälten");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        type: parsed.data.type,
        message: parsed.data.message,
        email: parsed.data.email && parsed.data.email.length > 0 ? parsed.data.email : null,
        user_id: user?.id ?? null,
        route: location.pathname + location.search,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });

      if (error) throw error;

      toast.success("Tack för din feedback!", {
        description: "Vi läser allt som kommer in.",
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Feedback submit error:", err);
      toast.error("Kunde inte skicka — försök igen om en stund");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <div className="mx-auto w-full max-w-lg overflow-y-auto px-4 pb-6">
          <DrawerHeader className="px-1">
            <DrawerTitle
              style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400 }}
              className="text-2xl"
            >
              Hjälp oss bli bättre
            </DrawerTitle>
            <DrawerDescription>
              Berätta vad du tycker — förslag, buggar eller bara tankar. Vi läser allt.
            </DrawerDescription>
          </DrawerHeader>

          <form onSubmit={handleSubmit} className="space-y-5 px-1 pt-2">
            {/* Type */}
            <div className="space-y-2">
              <Label>Typ av feedback</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {FEEDBACK_TYPES.map((t) => {
                  const Icon = t.icon;
                  const active = type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors text-xs font-medium ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="feedback-message">
                Meddelande{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({message.length}/1000)
                </span>
              </Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
                placeholder="Skriv här…"
                rows={5}
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="feedback-email">
                E-post{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  (valfritt — om du vill ha svar)
                </span>
              </Label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="namn@exempel.se"
                autoComplete="email"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Avbryt
              </Button>
              <Button type="submit" disabled={submitting || message.trim().length === 0}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Skickar…
                  </>
                ) : (
                  "Skicka feedback"
                )}
              </Button>
            </div>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default FeedbackDrawer;
