import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const reset = () => { setEmail(""); setPassword(""); };

  const handleLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ variant: "destructive", title: "Inloggning misslyckades", description: error.message });
    } else {
      toast({ title: "Inloggad!" });
      reset();
      onOpenChange(false);
    }
  };

  const handleSignup = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/plan-builder` },
    });
    setLoading(false);
    if (error) {
      toast({ variant: "destructive", title: "Registrering misslyckades", description: error.message });
    } else {
      toast({ title: "Konto skapat!", description: "Kolla din e-post för att bekräfta kontot." });
      reset();
      onOpenChange(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    tab === "login" ? handleLogin() : handleSignup();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Välkommen</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Logga in</TabsTrigger>
            <TabsTrigger value="signup">Skapa konto</TabsTrigger>
          </TabsList>
          <form onSubmit={onSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="auth-email">E-post</Label>
              <Input id="auth-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="namn@exempel.se" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-password">Lösenord</Label>
              <Input id="auth-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minst 6 tecken" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Vänta…" : tab === "login" ? "Logga in" : "Skapa konto"}
            </Button>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
