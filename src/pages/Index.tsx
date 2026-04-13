import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Lock, Calendar, Users, ChevronDown, Quote } from "lucide-react";

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
          Svara på fem frågor — få en komplett plan med datum, belopp och hur ni maximerar era dagar.
        </p>
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button size="lg" asChild>
            <Link to="/wizard">Skapa er plan — tar 5 min</Link>
          </Button>
          <p className="text-xs text-muted-foreground">Gratis. Inget konto krävs.</p>
          <Link
            to="/foraldraledighet-101"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors mt-1"
          >
            Hur funkar föräldradagar egentligen? →
          </Link>
        </div>
      </section>

      {/* Testimonial */}
      <section className="max-w-3xl mx-auto px-6 pb-10">
        <div className="flex flex-col items-center text-center gap-2">
          <Quote className="w-5 h-5 text-primary/40" />
          <blockquote className="text-sm md:text-base italic text-muted-foreground max-w-md leading-relaxed">
            "Vi hade ingen aning om hur vi skulle fördela dagarna. På fem minuter hade vi en plan som funkade för oss båda."
          </blockquote>
          <cite className="text-xs text-muted-foreground/70 not-italic">— Lisa & Erik</cite>
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

      {/* Clickable timeline mockup */}
      <section className="max-w-7xl mx-auto px-6 pb-16">
        <Link to="/wizard" className="block group max-w-3xl mx-auto">
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden transition-shadow group-hover:shadow-lg">
            {/* Header */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Så kan er plan se ut — klicka för att börja
              </p>
            </div>

            <div className="flex w-full">
              {/* Label column */}
              <div className="flex-shrink-0 bg-muted/20" style={{ width: 100 }}>
                <div className="h-8" />
                <div className="flex items-center gap-2 px-3" style={{ height: 52 }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#4A9B8E]" />
                  <span className="text-xs font-semibold text-[#4A9B8E]">Förälder 1</span>
                </div>
                <div className="flex items-center gap-2 px-3" style={{ height: 40 }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#2D7A6F]" />
                  <span className="text-xs font-semibold text-[#2D7A6F]">Dubbeldagar</span>
                </div>
                <div className="flex items-center gap-2 px-3" style={{ height: 52 }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#E8735A]" />
                  <span className="text-xs font-semibold text-[#E8735A]">Förälder 2</span>
                </div>
              </div>

              {/* Timeline area */}
              <div className="flex-1 relative" style={{ minWidth: 0 }}>
                <div className="relative h-8 border-b border-border/60">
                  {timelineMonths.map((m, i) => (
                    <div key={m} className="absolute top-0 bottom-0" style={{ left: `${(i / 12) * 100}%` }}>
                      <div className="absolute top-4 bottom-0 w-px bg-border/60" />
                      <span className="absolute top-3.5 text-[9px] text-muted-foreground/80 whitespace-nowrap" style={{ left: 2 }}>
                        {m.toLowerCase()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="relative">
                  {timelineMonths.map((_, i) =>
                    i > 0 ? (
                      <div key={`line-${i}`} className="absolute top-0 w-px bg-border/20 z-0" style={{ left: `${(i / 12) * 100}%`, height: 144 }} />
                    ) : null
                  )}

                  {/* F1 row */}
                  <div className="relative" style={{ height: 52 }}>
                    <div className="absolute top-2 bottom-2 rounded-xl shadow-md bg-[#4A9B8E]" style={{ left: "4%", width: "42%" }} />
                  </div>

                  {/* Separator line above double days */}
                  <div className="w-full h-px bg-border/30" />

                  {/* Overlap row */}
                  <div className="relative" style={{ height: 40 }}>
                    <div className="absolute top-1.5 bottom-1.5 rounded-xl shadow-md bg-[#2D7A6F]" style={{ left: "46%", width: "16%" }} />
                  </div>

                  {/* Separator line below double days */}
                  <div className="w-full h-px bg-border/30" />

                  {/* F2 row */}
                  <div className="relative" style={{ height: 52 }}>
                    <div className="absolute top-2 bottom-2 rounded-xl shadow-md bg-[#E8735A]" style={{ left: "62%", width: "34%" }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="h-3" />
          </div>
        </Link>
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

      {/* Sticky mobile CTA */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-background/95 backdrop-blur border-t border-border md:hidden z-50">
        <Button asChild size="lg" className="w-full">
          <Link to="/wizard">Skapa er plan — tar 5 min</Link>
        </Button>
      </div>
    </div>
  );
};

export default Index;
