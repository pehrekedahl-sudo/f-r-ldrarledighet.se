import { Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Menu, X, LogOut } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/hooks/useUser";
import { useHasPurchased } from "@/hooks/useHasPurchased";
import { supabase } from "@/integrations/supabase/client";

const links = [
  { to: "/", label: "Start" },
  { to: "/foraldraledighet-101", label: "Föräldradagar 101" },
  { to: "/plan-builder", label: "Min Plan" },
];

const TopNav = () => {
  const [open, setOpen] = useState(false);
  const { user, loading: userLoading } = useUser();
  const { hasPurchased } = useHasPurchased(user, userLoading);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-icon.svg" alt="" className="h-7 w-auto" />
          <div className="flex flex-col" style={{ gap: '1px', lineHeight: 1.1 }}>
            <span className="font-bold text-sm tracking-tight" style={{ color: '#12201A' }}>Planera</span>
            <span className="font-bold text-sm tracking-tight" style={{ color: '#9BA8A2' }}>föräldraledighet</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-5">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className="text-base text-muted-foreground hover:text-foreground transition-colors"
              activeClassName="text-primary font-medium"
            >
              {l.label}
            </NavLink>
          ))}
          {user && hasPurchased && (
            <div className="flex items-center gap-3 ml-2 pl-4 border-l border-border">
              <span className="text-sm text-muted-foreground truncate max-w-[160px]">
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Logga ut"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Stäng meny" : "Öppna meny"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <nav className="md:hidden border-t border-border bg-background px-4 py-3 space-y-2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className="block text-base text-muted-foreground hover:text-foreground transition-colors py-1"
              activeClassName="text-primary font-medium"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
          {user && hasPurchased && (
            <div className="pt-2 mt-2 border-t border-border space-y-2">
              <span className="block text-sm text-muted-foreground truncate">
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                <LogOut className="h-4 w-4" />
                Logga ut
              </button>
            </div>
          )}
        </nav>
      )}
    </header>
  );
};

export default TopNav;
