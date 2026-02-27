import { Link, useLocation } from "react-router-dom";

const DevNav = () => {
  const { pathname } = useLocation();

  return (
    <div className="border-b border-border bg-muted/50 px-4 py-1.5 flex items-center gap-4 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/60">DEV</span>
      <Link
        to="/wizard"
        className={`hover:text-foreground transition-colors ${pathname === "/wizard" ? "text-foreground font-medium" : ""}`}
      >
        Gå till Wizard
      </Link>
      <Link
        to="/plan-builder"
        className={`hover:text-foreground transition-colors ${pathname === "/plan-builder" ? "text-foreground font-medium" : ""}`}
      >
        Gå till Plan Builder
      </Link>
      <Link
        to="/test-engine"
        className={`hover:text-foreground transition-colors ${pathname === "/test-engine" ? "text-foreground font-medium" : ""}`}
      >
        Test Engine
      </Link>
    </div>
  );
};

export default DevNav;
