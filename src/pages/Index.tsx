import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Lock, Calendar, Users, ChevronDown } from "lucide-react";

const stats = [
  {
    icon: Users,
    number: "480",
    unit: "dagar",
    text: "att dela på",
  },
  {
    icon: Lock,
    number: "90",
    unit: "dagar",
    text: "låsta per förälder",
  },
  {
    icon: Calendar,
    number: "12",
    unit: "år",
    text: "att använda dem",
  },
];

const timelineMonths = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

const Index = () => {
  const [showLimitations, setShowLimitations] = useState(false);
  return (
    <div className="min-h-screen bg-gradient-to-br from-[hsl(172,30%,96%)]/60 via-background to-[hsl(14,60%,96%)]/60">
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10 text-center space-y-5">
        <h1
          className="text-4xl md:text-5xl font-normal leading-tight text-foreground"
          style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}
        >
          Planera er föräldraledighet utan&nbsp;Excel‑kaos
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto leading-relaxed">
          480 dagar. SGI-tak, lägstanivådagar, reserverade dagar, 
          fyraårsregel och en ansökan till arbetsgivaren som helst ska in två månader innan. 
          Ingen normal människa håller koll på allt det där — så vi byggde ett verktyg som gör det åt er.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-1">
          <Button size="lg" asChild>
            <Link to="/wizard">Skapa er plan</Link>
          </Button>
          <Link
            to="/foraldraledighet-101"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
          >
            Hur funkar föräldradagar egentligen? →
          </Link>
        </div>
      </section>

      {/* Snapshot cards */}
      <section className="max-w-7xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {stats.map((s) => (
            <div
              key={s.number}
              className="rounded-xl border-2 border-border bg-card shadow-sm p-6 text-center space-y-3"
            >
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <span
                  className="text-3xl font-normal text-foreground"
                  style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}
                >
                  {s.number}
                </span>
                <span className="text-sm text-muted-foreground ml-1">{s.unit}</span>
              </div>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline mockup */}
      <section className="max-w-7xl mx-auto px-6 pb-16">
        <div className="rounded-xl border-2 border-border bg-card shadow-sm p-6 space-y-4 max-w-3xl mx-auto">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Så kan en plan se ut
          </p>
          {/* Month labels */}
          <div className="flex gap-0">
            {timelineMonths.map((m) => (
              <div key={m} className="flex-1 text-center text-sm text-muted-foreground">
                {m}
              </div>
            ))}
          </div>
          {/* Parent 1 bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-8 shrink-0">F1</span>
            <div className="flex-1 h-7 rounded-md bg-muted relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-md"
                style={{
                  width: "58%",
                  background: "hsl(172, 37%, 44%)",
                }}
              />
              <div
                className="absolute inset-y-0 rounded-md opacity-50"
                style={{
                  left: "58%",
                  width: "17%",
                  background: "hsl(172, 37%, 44%)",
                }}
              />
            </div>
          </div>
          {/* Parent 2 bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-8 shrink-0">F2</span>
            <div className="flex-1 h-7 rounded-md bg-muted relative overflow-hidden">
              <div
                className="absolute inset-y-0 rounded-md"
                style={{
                  left: "25%",
                  width: "42%",
                  background: "hsl(14, 60%, 60%)",
                }}
              />
              <div
                className="absolute inset-y-0 rounded-md opacity-50"
                style={{
                  left: "67%",
                  width: "25%",
                  background: "hsl(14, 60%, 60%)",
                }}
              />
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 pt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: "hsl(172, 37%, 44%)" }} />
              <span className="text-[10px] text-muted-foreground">Förälder 1</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: "hsl(14, 60%, 60%)" }} />
              <span className="text-[10px] text-muted-foreground">Förälder 2</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-muted border border-border" />
              <span className="text-[10px] text-muted-foreground">Ledig utan ersättning</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 pb-20 text-center space-y-4">
        <h2
          className="text-2xl font-normal text-foreground"
          style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}
        >
          Redo att planera?
        </h2>
        <Button size="lg" asChild>
          <Link to="/wizard">Skapa er plan</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          <Link
            to="/foraldraledighet-101"
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            Vill du förstå systemet först? →
          </Link>
        </p>
      </section>

      {/* Limitations toggle */}
      <section className="max-w-3xl mx-auto px-6 pb-8">
        <button
          onClick={() => setShowLimitations(!showLimitations)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors mx-auto"
        >
          Det här stöder vi inte än
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLimitations ? "rotate-180" : ""}`} />
        </button>
        {showLimitations && (
          <div className="mt-3 text-xs text-muted-foreground/70 space-y-2 text-center">
            <p>
              Verktyget är byggt för två föräldrar med fast anställning och ett barn. Vi jobbar på att utöka stödet – följande scenarion hanteras inte korrekt idag:
            </p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Ensamstående föräldrar</li>
              <li>Familjer med sparade dagar från ett äldre barn</li>
              <li>Egenföretagare och föräldrar med oregelbunden inkomst</li>
            </ul>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center">
        <p className="text-xs text-muted-foreground">
          Simulering — kontrollera alltid mot Försäkringskassan
        </p>
      </footer>
    </div>
  );
};

export default Index;
