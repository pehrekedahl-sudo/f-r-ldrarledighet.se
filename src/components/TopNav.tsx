import { Link, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";

const links = [
  { to: "/", label: "Start" },
  { to: "/foraldraledighet-101", label: "Föräldradagar 101" },
  { to: "/plan-builder", label: "Min Plan" },
];

const TopNav = () => {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur border-b border-border">
      <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link to="/" className="text-sm font-semibold tracking-tight text-foreground">
          föräldrarledig.se
        </Link>
        <nav className="flex items-center gap-5">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              activeClassName="text-[#4A9B8E] font-medium"
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
};

export default TopNav;
