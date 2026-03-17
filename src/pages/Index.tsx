import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-24 pb-20 text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-normal leading-tight" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
          Planera er föräldraledighet utan&nbsp;Excel-kaos
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Se hur länge dagarna räcker och hur mycket ni får ut – innan ni ansöker.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <Button size="lg" asChild>
            <Link to="/wizard">Skapa vår plan</Link>
          </Button>
          <a
            href="#hur-det-funkar"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
          >
            Så funkar föräldradagar
          </a>
        </div>
      </section>

      {/* Value props */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "Simulera uttag",
              text: "Testa olika upplägg och se hur dagarna fördelas.",
            },
            {
              title: "Se ekonomisk effekt",
              text: "Få en tydlig bild av månadsersättning.",
            },
            {
              title: "Dela med din partner",
              text: "Skicka planen och justera tillsammans.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="border-l-2 border-primary pl-6 py-2 space-y-1"
            >
              <h3 className="font-medium text-lg">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section
        id="hur-det-funkar"
        className="max-w-3xl mx-auto px-6 pb-24 space-y-10"
      >
        <h2 className="text-2xl font-bold text-center">Så funkar det</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          {[
            { step: "1", text: "Svara på några frågor" },
            { step: "2", text: "Se hur planen påverkar ekonomin" },
            { step: "3", text: "Justera tills det känns rätt" },
          ].map((s) => (
            <div key={s.step} className="space-y-3">
              <div className="mx-auto w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
                {s.step}
              </div>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Index;
