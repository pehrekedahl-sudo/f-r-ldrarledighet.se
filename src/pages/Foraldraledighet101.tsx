import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const summaryPoints = [
  "Varje barn ger 480 dagar att dela på – det är FK som betalar, inte din arbetsgivare.",
  "Du får ut ~80\u00a0% av din lön för de flesta dagarna – men bara om du haft stabil inkomst i minst 240 dagar.",
  "90 dagar per förälder är låsta och kan inte ges bort. Resten kan ni flytta fritt mellan er.",
  "Den viktigaste avvägningen: hur många dagar tar du nu – och hur många sparar du till senare?",
];

const stats = [
  { value: "480", label: "dagar per barn totalt" },
  { value: "~80\u00a0%", label: "av lönen för de flesta dagar" },
  { value: "12 år", label: "tid att använda dagarna" },
  { value: "60", label: "dubbeldagar ni kan dela på" },
];

const timelineRules = [
  { tag: "0–4 år", text: "Inga begränsningar på hur många dagar ni sparar. Ta ut i den takt som passar er." },
  { tag: "4-årsdagen", text: "Viktigt: Har ni fler än 96 dagar kvar på barnets 4-årsdag försvinner överskottet permanent. Ni kan inte spara mer än 96 dagar sammanlagt från och med nu." },
  { tag: "4–12 år", text: "Ni har upp till 96 dagar kvar att använda – ungefär 10 dagar per år. Perfekt för skollov, studiedagar eller inskolning." },
  { tag: "12 år / åk 5", text: "Sista dagen att ta ut föräldrapenning. Dagar som inte använts försvinner." },
];

const mistakes = [
  "Glömmer dubbeldagarna – kräver aktiv ansökan och att båda tar ut i exakt samma omfattning samma dag",
  "Missar 4-årsregeln – har ni fler än 96 dagar kvar på barnets 4-årsdag försvinner överskottet permanent",
  "SGI-fällan – tar ut för få dagar per vecka efter 1-årsdagen utan att jobba tillräckligt, och får en sänkt SGI som slår mot sjukpenning och framtida föräldraledigheter",
  "Missar att de 90 låsta dagarna brinner inne – om en förälder tar allt förlorar ni 90 SGI-dagar permanent",
];

const features = [
  { title: "Planera period för period", desc: "Lägg upp vem som är ledig när, i vilken takt och hur länge" },
  { title: "Se inkomsten i realtid", desc: "Hur mycket ni får ut varje månad baserat på era val" },
  { title: "Dubbeldagar & sparade dagar", desc: "Verktyget håller reda på dagssaldo och varnar vid konflikter" },
  { title: "Justera och jämför", desc: "Testa olika scenarier och se vad som passar er bäst" },
];

/* small helpers */
const Dot = ({ color, size = 8 }: { color: string; size?: number }) => (
  <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: color }} />
);

const InfoBox = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted rounded-lg p-3 text-sm">{children}</div>
);

const WarnBox = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-lg p-3 text-sm ${className}`} style={{ backgroundColor: "#fdf0ec", borderColor: "#f0c4b4", color: "#7a3520", borderWidth: 1 }}>
    {children}
  </div>
);

const NumberCircle = ({ n }: { n: number }) => (
  <span className="inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-full text-xs font-medium text-white" style={{ backgroundColor: "#4A9B8E" }}>
    {n}
  </span>
);

/* ─── Page ─── */
const Foraldraledighet101 = () => {
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get("section") || "";
  const [openItem, setOpenItem] = useState(sectionParam || "");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sectionParam) {
      setOpenItem(sectionParam);
      setTimeout(() => {
        const el = document.getElementById(`section-${sectionParam}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
  }, [sectionParam]);

  return (
  <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-8">
    {/* Hero */}
    <header className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "#4A9B8E" }}>
        Föräldradagar 101
      </p>
      <h1 className="text-2xl font-medium">Allt du behöver veta – utan krånglet</h1>
      <p className="text-muted-foreground">
        Det svenska föräldraförsäkringssystemet är generöst men rörigt att förstå. Här är det du faktiskt behöver ta med dig.
      </p>
    </header>

    {/* Executive summary */}
    <section className="rounded-xl" style={{ backgroundColor: "#f0f8f6", borderColor: "#c2e3df", borderWidth: 1, padding: "1.25rem 1.5rem" }}>
      <p className="text-xs uppercase tracking-widest font-medium mb-3" style={{ color: "#2D7A6F" }}>
        Det viktigaste på 60 sekunder
      </p>
      <ol className="flex flex-col gap-2">
        {summaryPoints.map((text, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <NumberCircle n={i + 1} />
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </section>

    {/* Stats row */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="bg-muted rounded-lg p-3 text-center">
          <p className="text-xl font-medium">{s.value}</p>
          <p className="text-xs text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </div>

    {/* Accordion */}
    <Accordion type="single" collapsible className="border rounded-xl overflow-hidden" value={openItem} onValueChange={setOpenItem}>
      {/* Section 1 */}
      <AccordionItem value="days-split">
        <AccordionTrigger className="px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2.5 text-left">
            <Dot color="#4A9B8E" />
            <span>
              <span className="block text-sm font-medium">Hur dagarna är uppdelade</span>
              <span className="block text-xs text-muted-foreground">480 dagar, två nivåer, och vad som faktiskt går att flytta</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5 flex flex-col gap-3 text-sm">
          <p>
            Av 480 dagar ersätts 390 på sjukpenningnivå (baserat på din lön) och 90 på lägstanivå (fast 180&nbsp;kr/dag).
            Lägstanivådagarna kan inte tas ut förrän ni gemensamt tagit ut minst 180 dagar på sjukpenningnivå.
          </p>

          {/* Day bar */}
          <div className="flex h-6 rounded overflow-hidden text-[10px] font-medium leading-6">
            <div className="flex items-center justify-center text-white" style={{ width: "18.75%", backgroundColor: "#4A9B8E" }}>90 låsta</div>
            <div className="flex items-center justify-center" style={{ width: "62.5%", backgroundColor: "#2D7A6F", color: "#e8f5f3" }}>300 SGI + 90 lägstanivå – fria att flytta</div>
            <div className="flex items-center justify-center text-white" style={{ width: "18.75%", backgroundColor: "#E8735A" }}>90 låsta</div>
          </div>

          {/* Legend */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Dot color="#4A9B8E" /> Förälder 1 – låsta</span>
            <span className="flex items-center gap-1.5"><Dot color="#E8735A" /> Förälder 2 – låsta</span>
          </div>

          <p>
            De 90 låsta dagarna per förälder kan aldrig ges till den andra. Om en förälder tar alla dagar "brinner"
            90 SGI-dagar inne – ni har i praktiken bara 300 SGI-dagar att röra er med.
          </p>

          <InfoBox>
            Alla 90 lägstanivådagar och de 300 övriga SGI-dagarna kan fritt fördelas om mellan er via en ansökan till FK.
          </InfoBox>
        </AccordionContent>
      </AccordionItem>

      {/* Section 2 */}
      <AccordionItem value="save-days">
        <AccordionTrigger className="px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2.5 text-left">
            <Dot color="#4A9B8E" />
            <span>
              <span className="block text-sm font-medium">Hur länge kan man spara dagar?</span>
              <span className="block text-xs text-muted-foreground">Tidsgränser och den viktiga 4-årsregeln</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5 flex flex-col gap-3 text-sm">
          <p>Ni har gott om tid att använda dagarna – men systemet sätter upp två hårda gränser som är viktiga att känna till.</p>

          <div className="flex flex-col gap-2">
            {timelineRules.map((r) => (
              <div key={r.tag} className="bg-muted rounded-lg p-3 flex gap-3 items-start">
                <span className="text-xs font-medium shrink-0" style={{ color: "#4A9B8E", minWidth: 52 }}>{r.tag}</span>
                <span className="text-sm">{r.text}</span>
              </div>
            ))}
          </div>

          {/* Timeline bar */}
          <div className="flex flex-col gap-1">
            <div className="flex h-4 rounded overflow-hidden text-[10px] font-medium leading-4">
              <div className="flex items-center justify-center text-white" style={{ width: "33.33%", backgroundColor: "#4A9B8E" }} />
              <div className="flex items-center justify-center text-white" style={{ width: "66.67%", backgroundColor: "#E8B89A" }} />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Födsel</span>
              <span>4 år – max 96 dagar kvar</span>
              <span>12 år</span>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Dot color="#4A9B8E" /> Fritt uttag</span>
              <span className="flex items-center gap-1.5"><Dot color="#E8B89A" /> Max 96 dagar</span>
            </div>
          </div>

          <WarnBox>
            Tvillingar: Gränsen är 132 dagar (inte 96) från 4-årsdagen.
          </WarnBox>
        </AccordionContent>
      </AccordionItem>

      {/* Section 3 */}
      <AccordionItem value="compensation">
        <AccordionTrigger className="px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2.5 text-left">
            <Dot color="#4A9B8E" />
            <span>
              <span className="block text-sm font-medium">Vad du faktiskt får betalt</span>
              <span className="block text-xs text-muted-foreground">SGI, inkomsttaket och varför din inkomst just nu spelar roll</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5 flex flex-col gap-3 text-sm">
          <p>
            FK räknar ut din ersättning baserat på din SGI – sjukpenninggrundande inkomst. Det är din försäkrade inkomst hos FK,
            inte nödvändigtvis din aktuella lön.
          </p>

          {/* Level bars */}
          <div className="flex flex-col gap-2">
            {([
              { label: "Sjukpenningnivå", pct: "80%", bg: "#4A9B8E", val: "~80\u00a0% av SGI" },
              { label: "Grundnivå", pct: "25%", bg: "#c2e3df", val: "250 kr/dag" },
              { label: "Lägstanivå", pct: "14%", bg: "#e8f0ef", val: "180 kr/dag" },
            ] as const).map((l) => (
              <div key={l.label} className="flex items-center gap-2">
                <span className="text-xs w-[120px] shrink-0">{l.label}</span>
                <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: l.pct, backgroundColor: l.bg }} />
                </div>
                <span className="text-xs w-[90px] text-right text-muted-foreground">{l.val}</span>
              </div>
            ))}
          </div>

          <p>
            Sjukpenningnivå kräver att du arbetat minst 240 dagar i följd med en årsinkomst på minst 85&nbsp;000&nbsp;kr.
            Grundnivå (250&nbsp;kr/dag) gäller den som inte uppfyller kravet. Lägstanivån (180&nbsp;kr/dag) är de sista 90 dagarna
            som alla har rätt till.
          </p>

          <InfoBox>
            Det finns ett inkomsttak – ersättning beräknas på max ca 592&nbsp;000&nbsp;kr/år (2026). Tjänar du mer täcker ofta
            kollektivavtalet mellanskillnaden.
          </InfoBox>
        </AccordionContent>
      </AccordionItem>

      {/* Section 4 */}
      <AccordionItem value="tradeoffs" id="section-tradeoffs">
        <AccordionTrigger className="px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2.5 text-left">
            <Dot color="#E8735A" />
            <span>
              <span className="block text-sm font-medium">De tre avvägningarna</span>
              <span className="block text-xs text-muted-foreground">Frågorna ni faktiskt behöver ta ställning till</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5 flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            {/* Uttagstakt – full width */}
            <div className="col-span-2 bg-muted rounded-lg p-3" style={{ borderWidth: 1, borderColor: "#4A9B8E" }}>
              <p className="font-medium mb-1">Uttagstakt – den avvägning alla ställs inför</p>
              <p>
                Hur många dagar tar du ut nu och får i inkomst under ledigheten – kontra hur många sparar du för att ha kvar
                till kommande somrar, inskolning eller när barnet börjar skolan? Fler dagar nu = högre månadsinkomst.
                Färre dagar nu = mer flexibilitet senare.
              </p>
              <WarnBox className="mt-2">
                <strong>SGI-varning efter 1-årsdagen:</strong> Från barnets 1-årsdag måste du ta ut minst 5 hela föräldradagar
                i veckan om du är hemma och inte jobbar – annars räknar FK om din SGI till din faktiska (lägre) inkomst.
                Det slår mot vad du får vid sjukdom och framtida föräldraledigheter. Jobbar du deltid och tar ut föräldradagar
                för resterande tid är du skyddad.
              </WarnBox>
            </div>

            <div className="bg-muted rounded-lg p-3">
              <p className="font-medium mb-1">Vem tar mest?</p>
              <p>Den som tjänar mer tappar mer i ersättning vid lång ledighet. Jämlik fördelning kostar ofta kortsiktigt men gynnar båda karriärer på lång sikt.</p>
            </div>

            <div className="bg-muted rounded-lg p-3">
              <p className="font-medium mb-1">Hel- eller deltid hemma?</p>
              <p>Heltidsledighet tar dagar snabbare. Deltid kombinerat med jobb sträcker ut perioden men ger lägre veckoinkomst.</p>
            </div>

            {/* Dubbeldagarna – full width */}
            <div className="col-span-2 bg-muted rounded-lg p-3">
              <p className="font-medium mb-1">Dubbeldagarna</p>
              <p>
                Ni har rätt till 60 dubbeldagar (barn födda efter juli 2024) – dagar då båda tar ut föräldrapenning samtidigt,
                fram till 15 månader. Kräver att ni tar ut i samma omfattning och att ni aktivt ansöker.
              </p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Section 5 */}
      <AccordionItem value="mistakes">
        <AccordionTrigger className="px-5 py-4 hover:no-underline">
          <span className="flex items-center gap-2.5 text-left">
            <Dot color="#E8735A" />
            <span>
              <span className="block text-sm font-medium">Vanliga misstag</span>
              <span className="block text-xs text-muted-foreground">Det FK inte påminner dig om</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-5">
          <ul className="flex flex-col gap-2">
            {mistakes.map((m, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="inline-block shrink-0 w-[5px] h-[5px] rounded-full mt-2" style={{ backgroundColor: "#E8735A" }} />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

    {/* Tool CTA */}
    <section className="bg-muted rounded-xl p-7 flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "#E8735A" }}>Verktyget</p>
      <h2 className="text-xl font-medium">Planera er föräldraledighet dag för dag</h2>
      <p className="text-sm text-muted-foreground">
        Planera din föräldraledighet hjälper er att omsätta allt det här i en konkret plan. Ni ser direkt hur era val påverkar inkomst,
        dagssaldo och hur länge ledigheten räcker.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {features.map((f) => (
          <div key={f.title} className="bg-background rounded-lg p-3 border text-sm">
            <p className="font-medium mb-0.5">{f.title}</p>
            <p className="text-xs text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>
      <Link
        to="/plan-builder"
        className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity self-start"
        style={{ backgroundColor: "#4A9B8E" }}
      >
        Börja planera →
      </Link>
    </section>
   </div>
  );
};

export default Foraldraledighet101;
